#!/usr/bin/env python3
"""nimrod-lock-helper.py - THE PI'S HALF OF "LOCK THIS SCREEN" (2026-10-05; web/client/screen_lock.js is the site's half).

Mike, 2026-10-05: lock a screen with Ctrl+Shift+L so people can use everything inside the dashboards but cannot get
out to the computer; "I'd like to be able to stay out of it though when I unlock, so we can watch Netflix and stuff."

The page cannot see the computer and the computer cannot see the page, so the page TELLS this helper (a POST from
`createLockReporter`, when the kiosk was launched with `?lockHelper=http://127.0.0.1:8765/screen-lock`) and the
launcher, the pause chord and the TV chord ASK it (`--check`). Three states, the page's own:
    never told       - today's screen, exactly: everything behaves as it did before this file existed
    locked           - the pause chord and the TV chord refuse; (optional) labwc's escape keys are switched off
    unlocked by a person (stayOut) - Chromium closed on purpose stays closed (the launcher exits 75, which the unit
                                     does not restart); the TV chord opens a separate browser window

WHAT IT KEEPS (atomically: written to a temporary file, then renamed over the old one):
    $XDG_RUNTIME_DIR/nimrod/lock.json   what the launcher reads. In RAM: GONE AT EVERY BOOT, ON PURPOSE, so a reboot
                                        always brings the kiosk up exactly as before, whatever was last said.
    ~/.local/state/nimrod/lock.json     a copy that survives a reboot, for a person reading what happened. Nothing
                                        decides anything from it.

WHO MAY TELL IT: only on 127.0.0.1 (never another computer), only a POST whose Origin is the kiosk site's
(`NIMROD_LOCK_ORIGINS`, else the origin of `NIMROD_KIOSK_URL`), only a small JSON body with true/false values.
A web page from any other site is refused, and a browser will not even send it (the preflight fails).

CHROMIUM MUST BE TOLD THE SITE MAY REACH THIS COMPUTER (seen on the bench 2026-10-05): otherwise the page's first
report puts "<site> wants to access other apps and services on this device - Block / Allow" on the screen until
somebody answers. install-linux.sh writes that policy only when asked (NIMROD_LOCK_POLICY=1), and kiosk-launch.sh
passes the page `lockHelper=off` until it exists - so without it nothing here is ever asked anything, and the kiosk
behaves exactly as before.

NOT BUILT, argued: a heartbeat watchdog (restart the kiosk when the page stops reporting). A page that never reports
(no policy, an old site, a pairing screen) would be restarted forever; `heard` is kept in lock.json so one can be
added on top of real numbers later.

HARD-CODED, each with its reason:
    port 8765      matches the launcher's default `?lockHelper=` address; free on both Pis (8080 is the old dashboard).
                   Moved with NIMROD_LOCK_PORT (and NIMROD_LOCK_HELPER_URL in the unit to match).
    300 s fresh    the page reports every 60 s (screen_lock.js HELPER_BEAT_MS). Five missed beats means the page was not
                   running normally, and then the safer reading is "nobody said stay out": the kiosk comes back.
    1024 bytes     the page sends three small fields; anything bigger is not the page.

Stdlib only (python3 on Raspberry Pi OS). Tested by test_lock_helper.py next to it.
"""
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PORT = int(os.environ.get('NIMROD_LOCK_PORT', '8765'))
PATH = '/screen-lock'
FRESH_S = 300
MAX_BODY = 1024
EXIT_STAY_OUT = 75      # = the unit's RestartPreventExitStatus / SuccessExitStatus


def runtime_file():
    base = os.environ.get('XDG_RUNTIME_DIR') or f'/run/user/{os.getuid()}'
    return os.path.join(base, 'nimrod', 'lock.json')


def state_file():
    base = os.environ.get('XDG_STATE_HOME') or os.path.join(os.path.expanduser('~'), '.local', 'state')
    return os.path.join(base, 'nimrod', 'lock.json')


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
    raw = os.environ.get('NIMROD_LOCK_ORIGINS', '').strip()
    if raw:
        return {o for o in (origin_of(x.strip()) for x in raw.split(',')) if o}
    o = origin_of(os.environ.get('NIMROD_KIOSK_URL', ''))
    return {o} if o else set()


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.lock-', dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_state(path=None):
    """The last thing the page said, or None (never told, or unreadable: both mean 'as before')."""
    try:
        with open(path or runtime_file(), encoding='utf-8') as f:
            s = json.load(f)
        return s if isinstance(s, dict) else None
    except (OSError, ValueError):
        return None


def is_fresh(s, now=None):
    return bool(s) and isinstance(s.get('heard'), (int, float)) and ((now or time.time()) - s['heard']) <= FRESH_S


def check(what, now=None):
    """--check: 'stayout' -> fresh and unlocked by a person; 'locked' -> fresh and locked. Exit 0 = yes, 1 = no."""
    s = read_state()
    if not is_fresh(s, now):
        return False
    if what == 'stayout':
        return s.get('locked') is False and s.get('stayOut') is True
    if what == 'locked':
        return s.get('locked') is True
    return False


# ---- THE LOCKED / OPEN KEYBOARD (optional: NIMROD_LOCK_RC_SWAP=1) -------------------------------------------------
# labwc's own keys (Alt+F4 closes the kiosk, Alt+Tab, and this installer's Ctrl+Alt+Shift+Esc pause) are the window
# manager's, so no page can take them. While LOCKED, rc.xml is swapped for a copy whose <keyboard> keeps only the
# keybinds that run nimrod-kiosk-back.sh ("bring the kiosk back") and drops <default />; on unlock the open copy goes
# back. SAFETY, argued: it only ever writes rc.xml when rc.xml is byte-for-byte one of its two copies (a hand edit is
# never overwritten: it says so and leaves it), every copy is parsed as XML before it is written, and at the helper's
# own start the OPEN copy goes back - so a reboot always starts with the keys as before.
RC_DIR = os.path.join(os.path.expanduser('~'), '.config', 'labwc')
KEEP_MARK = 'nimrod-kiosk-back'   # a keybind whose command runs nimrod-kiosk-back.sh stays while locked


def rc_paths():
    d = os.environ.get('NIMROD_LABWC_DIR', RC_DIR)
    return os.path.join(d, 'rc.xml'), os.path.join(d, 'rc.open.xml'), os.path.join(d, 'rc.locked.xml')


def locked_variant(open_xml):
    """The locked copy of an rc.xml: <keyboard> loses <default /> and every keybind that does not run nimrod-kiosk-back.sh."""
    root = ET.fromstring(open_xml)
    for kb in root.iter('keyboard'):
        for child in list(kb):
            if child.tag == 'default':
                kb.remove(child)
            elif child.tag == 'keybind' and KEEP_MARK not in (child.get('key', '') + ' ' + ' '.join(
                    (a.get('command') or '') for a in child.iter('action'))):
                kb.remove(child)
    return '<?xml version="1.0"?>\n' + ET.tostring(root, encoding='unicode') + '\n'


def _read(p):
    try:
        with open(p, encoding='utf-8') as f:
            return f.read()
    except OSError:
        return None


def reconfigure_labwc():
    """labwc re-reads rc.xml on SIGHUP. Not `labwc --reconfigure`: that needs $LABWC_PID, which a service lacks."""
    try:
        subprocess.run(['pkill', '-HUP', '-U', str(os.getuid()), '-x', 'labwc'], check=False, timeout=5)
    except (OSError, subprocess.SubprocessError):
        pass


def swap_rc(locked, log=print):
    if os.environ.get('NIMROD_LOCK_RC_SWAP') != '1':
        return 'off'
    rc, open_p, locked_p = rc_paths()
    open_xml = _read(open_p)
    if open_xml is None:
        return 'no-open-copy'
    try:
        want = locked_variant(open_xml) if locked else open_xml
        ET.fromstring(want)
    except ET.ParseError as err:
        log(f'lock helper: the open rc.xml copy does not parse, keys left alone ({err})')
        return 'bad-xml'
    if locked:
        if _read(locked_p) != want:
            write_atomic(locked_p, want)
    now = _read(rc)
    if now == want:
        return 'same'
    if now is not None and now not in (open_xml, _read(locked_p)):
        log(f'lock helper: {rc} was edited by hand, so it is left alone (the keys do not follow the lock)')
        return 'hand-edited'
    write_atomic(rc, want)
    reconfigure_labwc()
    return 'swapped'


class Handler(BaseHTTPRequestHandler):
    server_version = 'nimrod-lock-helper'

    def log_message(self, fmt, *args):     # one line per request in the journal, never the body
        sys.stderr.write('lock helper: ' + (fmt % args) + '\n')

    def _origin_ok(self):
        o = self.headers.get('Origin')
        return o if o and origin_of(o) in self.server.origins else None

    def _cors(self, origin):
        self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Chromium's Private Network Access preflight (a public site asking a loopback address).
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Max-Age', '600')

    def _reply(self, code, obj=None, origin=None):
        body = b'' if obj is None else json.dumps(obj).encode('utf-8')
        self.send_response(code)
        if origin:
            self._cors(origin)
        if obj is not None:
            self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        origin = self._origin_ok()
        if urlsplit(self.path).path != PATH or not origin:
            return self._reply(403, {'ok': False, 'reason': 'origin'})
        self._reply(204, origin=origin)

    def do_GET(self):
        if urlsplit(self.path).path != PATH:
            return self._reply(404, {'ok': False})
        s = read_state()
        self._reply(200, {'state': s, 'fresh': is_fresh(s)}, origin=self._origin_ok())

    def do_POST(self):
        if urlsplit(self.path).path != PATH:
            return self._reply(404, {'ok': False})
        origin = self._origin_ok()
        if not origin:
            return self._reply(403, {'ok': False, 'reason': 'origin'})
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = -1
        if n <= 0 or n > MAX_BODY:
            return self._reply(413 if n > MAX_BODY else 400, {'ok': False, 'reason': 'size'}, origin)
        try:
            body = json.loads(self.rfile.read(n).decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            return self._reply(400, {'ok': False, 'reason': 'json'}, origin)
        if not isinstance(body, dict) or not isinstance(body.get('locked'), bool) or not isinstance(body.get('stayOut', False), bool):
            return self._reply(400, {'ok': False, 'reason': 'shape'}, origin)
        locked = body['locked']
        prev = read_state()
        s = {'v': 1, 'locked': locked, 'stayOut': (not locked) and body.get('stayOut', False) is True,
             'at': body.get('at') if isinstance(body.get('at'), (int, float)) else None,
             'heard': time.time(), 'origin': origin_of(origin)}
        data = json.dumps(s)
        write_atomic(runtime_file(), data)
        try:
            write_atomic(state_file(), data)
        except OSError as err:
            self.log_message('could not keep the copy: %s', err)
        keys = None
        if not prev or prev.get('locked') != locked:
            try:
                keys = swap_rc(locked, log=lambda m: sys.stderr.write(m + '\n'))
            except OSError as err:
                keys = f'error: {err}'
                self.log_message('keys: %s', err)
        self._reply(200, {'ok': True, 'locked': s['locked'], 'stayOut': s['stayOut'], 'keys': keys}, origin)


def serve():
    origins = allowed_origins()
    if not origins:
        sys.stderr.write('lock helper: no site origin (set NIMROD_KIOSK_URL or NIMROD_LOCK_ORIGINS); refusing every POST\n')
    # At the helper's own start: the keys as before (see THE LOCKED / OPEN KEYBOARD).
    try:
        swap_rc(False)
    except OSError as err:
        sys.stderr.write(f'lock helper: keys: {err}\n')
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    httpd.origins = origins
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    sys.stderr.write(f'lock helper: on 127.0.0.1:{PORT}{PATH} for {", ".join(sorted(origins)) or "nobody"}\n')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


def main(argv):
    if len(argv) >= 2 and argv[0] == '--check' and argv[1] in ('stayout', 'locked'):
        return 0 if check(argv[1]) else 1
    if argv and argv[0] == '--state':
        s = read_state()
        print(json.dumps({'state': s, 'fresh': is_fresh(s)}))
        return 0
    if argv and argv[0] == '--locked-variant' and len(argv) == 2:     # for the installer: print rc.locked.xml
        sys.stdout.write(locked_variant(_read(argv[1]) or ''))
        return 0
    if argv:
        sys.stderr.write('usage: nimrod-lock-helper.py [--check stayout|locked | --state | --locked-variant RC]\n')
        return 2
    serve()
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
