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

    # ---- the computer's own default speaker (row 2.232) ----
    DUMP = [
        {'id': 41, 'type': 'PipeWire:Interface:Node', 'info': {'props': {'media.class': 'Audio/Sink', 'node.name': 'hdmi-sink', 'node.description': 'TV'}}},
        {'id': 57, 'type': 'PipeWire:Interface:Node', 'info': {'props': {'media.class': 'Audio/Sink', 'node.name': 'emeet-sink', 'node.description': 'EMEET speakerphone'}}},
        {'id': 60, 'type': 'PipeWire:Interface:Node', 'info': {'props': {'media.class': 'Audio/Source', 'node.name': 'a-mic'}}},
        {'id': 30, 'type': 'PipeWire:Interface:Metadata', 'props': {'metadata.name': 'default'}, 'metadata': [
            {'subject': 0, 'key': 'default.configured.audio.sink', 'type': 'Spa:String:JSON', 'value': {'name': 'emeet-sink'}},
            {'subject': 0, 'key': 'default.audio.sink', 'type': 'Spa:String:JSON', 'value': {'name': 'hdmi-sink'}}]},
    ]

    def audio(self, method, path, body=None, origin=SITE):
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        base = self.base[:-len(H.PATH)]
        r = urllib.request.Request(base + path, data=data, method=method)
        if origin:
            r.add_header('Origin', origin)
        if data is not None:
            r.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, dict(resp.headers), json.loads(resp.read() or b'null')
        except urllib.error.HTTPError as e:
            raw = e.read()
            return e.code, dict(e.headers), json.loads(raw) if raw else None

    def fake_tools(self, dump=None):
        calls = []
        def run(args, timeout=5):
            calls.append(args)
            if args[0] == 'pw-dump':
                return (0, json.dumps(self.DUMP if dump is None else dump)) if dump != 'gone' else (None, '')
            return 0, ''
        was = H.run_tool
        H.run_tool = run
        self.addCleanup(lambda: setattr(H, 'run_tool', was))
        return calls

    def test_speakers_are_read_by_name_and_playing_now(self):
        got = H.sinks_from_dump(self.DUMP)
        self.assertEqual([s['name'] for s in got['sinks']], ['hdmi-sink', 'emeet-sink'])     # not the microphone
        self.assertEqual(got['now'], 'hdmi-sink')                                            # playing now, not the one configured
        self.assertEqual(H.sinks_from_dump('nonsense'), {'sinks': [], 'now': None})

    def test_the_page_sees_no_numbers(self):
        self.fake_tools()
        code, h, j = self.audio('GET', '/audio')
        self.assertEqual(code, 200)
        self.assertEqual(h.get('Access-Control-Allow-Origin'), SITE)
        self.assertEqual(j['now'], 'hdmi-sink')
        self.assertEqual(j['sinks'][1], {'name': 'emeet-sink', 'description': 'EMEET speakerphone'})

    def test_another_site_cannot_read_or_change_the_speakers(self):
        calls = self.fake_tools()
        self.assertEqual(self.audio('GET', '/audio', origin='https://evil.example')[0], 403)
        self.assertEqual(self.audio('GET', '/audio', origin=None)[0], 403)
        self.assertEqual(self.audio('POST', '/audio/default', {'name': 'hdmi-sink'}, origin='https://evil.example')[0], 403)
        self.assertEqual(self.audio('OPTIONS', '/audio/default', origin='https://evil.example')[0], 403)
        self.assertEqual(calls, [])

    def test_the_preflight_for_a_speaker_change_is_answered(self):
        code, h, _ = self.audio('OPTIONS', '/audio/default')
        self.assertEqual(code, 204)
        self.assertEqual(h.get('Access-Control-Allow-Private-Network'), 'true')

    def test_choosing_a_speaker_looks_up_its_number_fresh(self):
        calls = self.fake_tools()
        code, _, j = self.audio('POST', '/audio/default', {'name': 'emeet-sink'})
        self.assertEqual(code, 200)
        self.assertTrue(j['ok'])
        self.assertIn(['wpctl', 'set-default', '57'], calls)

    def test_only_a_name_it_lists_is_accepted(self):
        calls = self.fake_tools()
        self.assertEqual(self.audio('POST', '/audio/default', {'name': '57; rm -rf /'})[0], 409)
        self.assertEqual(self.audio('POST', '/audio/default', {'name': 57})[0], 400)
        self.assertEqual(self.audio('POST', '/audio/default', b'x' * 2000)[0], 413)
        self.assertFalse([c for c in calls if c[0] == 'wpctl'])

    def test_no_pipewire_is_said_not_a_crash(self):
        self.fake_tools('gone')
        self.assertEqual(self.audio('GET', '/audio')[0], 503)
        self.assertEqual(self.audio('POST', '/audio/default', {'name': 'x'})[0], 503)

    # ---- "Go to the desktop" (Mike, 2026-11-10) ----
    def fake_pause(self, present=True):
        p = os.path.join(self.tmp, 'nimrod-kiosk-pause.sh')
        if present:
            with open(p, 'w') as f:
                f.write('#!/bin/sh\n')
            os.chmod(p, 0o755)
        runs = []
        was_p, was_s = H.PAUSE_SCRIPT, H.spawn
        H.PAUSE_SCRIPT = p
        H.spawn = lambda args, env: runs.append((args, env.get('NIMROD_PAUSE_TERMINAL')))
        self.addCleanup(lambda: (setattr(H, 'PAUSE_SCRIPT', was_p), setattr(H, 'spawn', was_s)))
        return p, runs

    def test_the_desktop_button_runs_the_chords_script_without_a_terminal(self):
        p, runs = self.fake_pause()
        code, h, j = self.audio('GET', '/desktop')
        self.assertEqual((code, j), (200, {'ok': True}))
        self.assertEqual(h.get('Access-Control-Allow-Origin'), SITE)
        self.assertEqual(self.audio('OPTIONS', '/desktop')[0], 204)
        code, _, j = self.audio('POST', '/desktop', {'go': True})
        self.assertEqual((code, j['ok']), (200, True))
        self.assertEqual(runs, [([p], '0')])

    def test_the_desktop_button_is_refused_while_locked(self):
        _, runs = self.fake_pause()
        self.assertEqual(self.req('POST', {'locked': True})[0], 200)
        code, _, j = self.audio('POST', '/desktop', {'go': True})
        self.assertEqual((code, j['reason']), (409, 'locked'))
        self.assertEqual(runs, [])

    def test_the_desktop_button_only_for_the_site_and_only_on_purpose(self):
        _, runs = self.fake_pause()
        self.assertEqual(self.audio('GET', '/desktop', origin='https://evil.example')[0], 403)
        self.assertEqual(self.audio('POST', '/desktop', {'go': True}, origin='https://evil.example')[0], 403)
        self.assertEqual(self.audio('POST', '/desktop', {'go': 1})[0], 400)
        self.assertEqual(self.audio('POST', '/desktop', [])[0], 400)
        self.assertEqual(runs, [])

    def test_no_pause_script_no_button(self):
        _, runs = self.fake_pause(present=False)
        self.assertEqual(self.audio('GET', '/desktop')[2], {'ok': False})
        self.assertEqual(self.audio('POST', '/desktop', {'go': True})[0], 503)
        self.assertEqual(runs, [])

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
