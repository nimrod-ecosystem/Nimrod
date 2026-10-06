"""test_lock_helper.py - nimrod-lock-helper.py, the Pi's half of "Lock this screen" (2026-10-05).

    py -3.13 -m unittest web/kiosk_installer/deploy/test_lock_helper.py      (or: python3 -m unittest ... on the Pi)

What it proves: only the kiosk site's origin may tell it anything, the browser's preflight gets every header it needs
(Private Network Access included), what it heard lands on disk atomically, "stay out" is read only while fresh, the
locked keyboard drops labwc's escape keys but keeps "bring it back", and a hand-edited rc.xml is never overwritten.
"""
import importlib.util
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('lock_helper', os.path.join(HERE, 'nimrod-lock-helper.py'))
H = importlib.util.module_from_spec(spec)
spec.loader.exec_module(H)

SITE = 'https://nimrodecosystem.com'
OPEN_RC = """<?xml version="1.0"?>
<labwc_config>
  <keyboard>
    <default />
    <keybind key="C-A-S-Escape"><action name="Execute" command="/home/u/.local/bin/nimrod-kiosk-pause.sh" /></keybind>
    <keybind key="C-A-S-Return"><action name="Execute" command="/home/u/.local/bin/nimrod-kiosk-back.sh" /></keybind>
    <keybind key="C-A-S-t"><action name="Execute" command="/home/u/.local/bin/nimrod-tv.sh" /></keybind>
  </keyboard>
</labwc_config>
"""


class LockHelperTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='lockhelper-')
        self.env = {k: os.environ.get(k) for k in ('XDG_RUNTIME_DIR', 'XDG_STATE_HOME', 'NIMROD_KIOSK_URL',
                                                    'NIMROD_LOCK_ORIGINS', 'NIMROD_LABWC_DIR', 'NIMROD_LOCK_RC_SWAP')}
        os.environ['XDG_RUNTIME_DIR'] = os.path.join(self.tmp, 'run')
        os.environ['XDG_STATE_HOME'] = os.path.join(self.tmp, 'state')
        os.environ['NIMROD_KIOSK_URL'] = SITE + '/kiosk.html?pair=1'
        os.environ.pop('NIMROD_LOCK_ORIGINS', None)
        os.environ['NIMROD_LABWC_DIR'] = os.path.join(self.tmp, 'labwc')
        os.environ.pop('NIMROD_LOCK_RC_SWAP', None)
        self.hups = []
        H.reconfigure_labwc = lambda: self.hups.append(1)
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), H.Handler)
        self.httpd.origins = H.allowed_origins()
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}{H.PATH}'
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def req(self, method, body=None, origin=SITE, headers=None):
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        r = urllib.request.Request(self.base, data=data, method=method)
        if origin:
            r.add_header('Origin', origin)
        if data is not None:
            r.add_header('Content-Type', 'application/json')
        for k, v in (headers or {}).items():
            r.add_header(k, v)
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def test_origin_is_the_kiosk_sites(self):
        self.assertEqual(H.allowed_origins(), {SITE})
        os.environ['NIMROD_LOCK_ORIGINS'] = 'https://a.example, http://127.0.0.1:8440/x'
        self.assertEqual(H.allowed_origins(), {'https://a.example', 'http://127.0.0.1:8440'})

    def test_preflight_has_every_header_chromium_wants(self):
        code, h, _ = self.req('OPTIONS', headers={'Access-Control-Request-Method': 'POST',
                                                  'Access-Control-Request-Headers': 'content-type',
                                                  'Access-Control-Request-Private-Network': 'true'})
        self.assertEqual(code, 204)
        self.assertEqual(h.get('Access-Control-Allow-Origin'), SITE)
        self.assertEqual(h.get('Access-Control-Allow-Private-Network'), 'true')
        self.assertIn('POST', h.get('Access-Control-Allow-Methods', ''))
        self.assertIn('Content-Type', h.get('Access-Control-Allow-Headers', ''))

    def test_another_site_is_refused(self):
        code, h, _ = self.req('OPTIONS', origin='https://evil.example')
        self.assertEqual(code, 403)
        self.assertNotIn('Access-Control-Allow-Origin', h)
        code, _, _ = self.req('POST', {'locked': True}, origin='https://evil.example')
        self.assertEqual(code, 403)
        code, _, _ = self.req('POST', {'locked': True}, origin=None)
        self.assertEqual(code, 403)
        self.assertIsNone(H.read_state())

    def test_bad_bodies_are_refused(self):
        self.assertEqual(self.req('POST', b'not json')[0], 400)
        self.assertEqual(self.req('POST', {'locked': 'yes'})[0], 400)
        self.assertEqual(self.req('POST', {'locked': True, 'pad': 'x' * 2000})[0], 413)
        self.assertIsNone(H.read_state())

    def test_what_the_page_says_is_kept_and_read(self):
        code, h, body = self.req('POST', {'locked': True, 'stayOut': False, 'at': 42})
        self.assertEqual(code, 200)
        self.assertEqual(h.get('Access-Control-Allow-Origin'), SITE)
        s = H.read_state()
        self.assertTrue(s['locked'])
        self.assertTrue(H.check('locked'))
        self.assertFalse(H.check('stayout'))
        self.assertTrue(os.path.exists(H.state_file()), 'the copy that survives a reboot')
        self.req('POST', {'locked': False, 'stayOut': True, 'at': 43})
        self.assertTrue(H.check('stayout'))
        self.assertFalse(H.check('locked'))
        # locked wins over a stray stayOut
        self.req('POST', {'locked': True, 'stayOut': True})
        self.assertFalse(H.check('stayout'))

    def test_stay_out_only_while_fresh(self):
        self.req('POST', {'locked': False, 'stayOut': True})
        self.assertTrue(H.check('stayout'))
        self.assertFalse(H.check('stayout', now=time.time() + H.FRESH_S + 1))
        self.assertFalse(H.check('locked', now=time.time() + H.FRESH_S + 1))

    def test_never_told_is_as_before(self):
        self.assertIsNone(H.read_state())
        self.assertFalse(H.check('stayout'))
        self.assertFalse(H.check('locked'))

    def test_locked_keyboard(self):
        v = H.locked_variant(OPEN_RC)
        self.assertNotIn('<default', v)
        self.assertNotIn('nimrod-kiosk-pause.sh', v)
        self.assertNotIn('nimrod-tv.sh', v)
        self.assertIn('nimrod-kiosk-back.sh', v)

    def test_rc_swap_follows_the_lock_and_never_a_hand_edit(self):
        os.environ['NIMROD_LOCK_RC_SWAP'] = '1'
        rc, open_p, locked_p = H.rc_paths()
        os.makedirs(os.path.dirname(rc))
        for p in (rc, open_p):
            with open(p, 'w', encoding='utf-8') as f:
                f.write(OPEN_RC)
        body = json.loads(self.req('POST', {'locked': True})[2])
        self.assertEqual(body['keys'], 'swapped')
        with open(rc, encoding='utf-8') as f:
            self.assertNotIn('nimrod-kiosk-pause.sh', f.read())
        self.assertEqual(len(self.hups), 1, 'labwc told to re-read its keys')
        self.req('POST', {'locked': True})                                   # a heartbeat: nothing to do
        self.assertEqual(len(self.hups), 1)
        self.req('POST', {'locked': False, 'stayOut': True})
        with open(rc, encoding='utf-8') as f:
            self.assertEqual(f.read(), OPEN_RC)
        with open(rc, 'a', encoding='utf-8') as f:
            f.write('<!-- somebody\'s own edit -->\n')
        body = json.loads(self.req('POST', {'locked': True})[2])
        self.assertEqual(body['keys'], 'hand-edited')
        with open(rc, encoding='utf-8') as f:
            self.assertIn('somebody', f.read())

    def test_rc_swap_off_unless_asked(self):
        self.assertEqual(H.swap_rc(True), 'off')


if __name__ == '__main__':
    unittest.main()
