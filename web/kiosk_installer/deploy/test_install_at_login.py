"""test_install_at_login.py - what install-linux.sh opens at login (2026-11-22, row 2.273).

    py -3.13 -m unittest web/kiosk_installer/deploy/test_install_at_login.py      (or: python3 -m unittest ... on the Pi)

Runs the whole installer into a throwaway home, with systemctl replaced by a stub on PATH, and proves: a new install opens
an ordinary window (Mike, 2026-11-22: "Installer should default to window"); NIMROD_AT_LOGIN= and NIMROD_WATCH=0 are
taken; a re-run without NIMROD_AT_LOGIN keeps what the computer opens now (a kiosk stays a kiosk, a window without the
watchdog stays one), including a computer installed before the choice existed; a bad word stops before anything is written.

Needs a bash (as test_login_mode.py: /bin/bash, or Git for Windows' bash). Skips without.
"""
import os
import shutil
import subprocess
import tempfile
import unittest

from test_login_mode import BASH, posix

HERE = os.path.dirname(os.path.abspath(__file__))
INSTALLER = os.path.join(HERE, 'install-linux.sh')
URL = 'https://site.example/kiosk.html'

STUB_SYSTEMCTL = r'''#!/bin/bash
echo "$*" >> "$FAKE_LOG"
case "$*" in *is-enabled*) echo disabled ;; esac
exit 0
'''


@unittest.skipIf(BASH is None, 'no bash here')
class InstallAtLoginTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = os.path.join(self.tmp, 'home')
        os.makedirs(self.home)
        self.stubs = os.path.join(self.tmp, 'stubs')
        os.makedirs(self.stubs)
        stub = os.path.join(self.stubs, 'systemctl')
        with open(stub, 'w', newline='\n') as f:
            f.write(STUB_SYSTEMCTL)
        os.chmod(stub, 0o755)
        self.log = os.path.join(self.tmp, 'systemctl.log')

    def install(self, **env):
        e = {k: v for k, v in os.environ.items() if not k.startswith('NIMROD_')}   # nothing leaks in from this shell
        e.update(HOME=posix(self.home), FAKE_LOG=posix(self.log), **env)
        cmd = 'export PATH="%s:$PATH"; bash "%s" "%s"' % (posix(self.stubs), posix(INSTALLER), URL)
        return subprocess.run([BASH, '-c', cmd], env=e, capture_output=True, text=True)

    def mode_script(self):
        return os.path.join(self.home, '.local', 'bin', 'nimrod-login-mode.sh')

    def current(self):
        e = dict(os.environ, HOME=posix(self.home))
        r = subprocess.run([BASH, posix(self.mode_script()), '--current'], env=e, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    def autostart(self):
        with open(os.path.join(self.home, '.config', 'labwc', 'autostart')) as f:
            return f.read()

    def ok(self, r):
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-2000:])
        return r.stdout

    def test_a_new_install_opens_an_ordinary_window_with_the_watchdog(self):
        out = self.ok(self.install())
        self.assertEqual(self.current(), 'window')
        self.assertIn('systemctl --user start nimrod-browser.service', self.autostart().splitlines())
        self.assertNotIn('systemctl --user start nimrod-kiosk.service', self.autostart().splitlines())
        self.assertIn('At login: window (new install, the default', out)
        self.assertIn('systemctl --user start nimrod-browser', out)

    def test_asked_for_wins_and_nimrod_watch_0_turns_the_watchdog_off(self):
        out = self.ok(self.install(NIMROD_AT_LOGIN='kiosk'))
        self.assertEqual(self.current(), 'kiosk')
        self.assertIn('Ctrl+Alt+Shift+Esc to STOP the kiosk', out)
        self.ok(self.install(NIMROD_AT_LOGIN='window', NIMROD_WATCH='0'))
        self.assertEqual(self.current(), 'window --no-watch')

    def test_a_re_run_keeps_what_the_computer_opens_now(self):
        for words in ('kiosk', 'fullscreen', 'window --no-watch', 'none'):
            mode, _, rest = words.partition(' ')
            self.ok(self.install(NIMROD_AT_LOGIN=mode, NIMROD_WATCH='0' if rest else '1'))
            out = self.ok(self.install())                      # a new address, say: nothing asked about login
            self.assertEqual(self.current(), words)
            self.assertIn('At login: %s (kept from before' % words, out)

    def test_a_computer_installed_before_the_choice_stays_a_kiosk(self):
        self.ok(self.install(NIMROD_AT_LOGIN='kiosk'))
        # what an 11-19 install left: no browser unit, and its own autostart text
        os.remove(os.path.join(self.home, '.config', 'systemd', 'user', 'nimrod-browser.service'))
        with open(os.path.join(self.home, '.config', 'labwc', 'autostart'), 'w', newline='\n') as f:
            f.write('systemctl --user daemon-reload\nsystemctl --user start nimrod-kiosk.service\n')
        self.ok(self.install())
        self.assertEqual(self.current(), 'kiosk')

    def test_a_bad_word_stops_before_anything_is_written(self):
        r = self.install(NIMROD_AT_LOGIN='windwo')
        self.assertEqual(r.returncode, 2)
        self.assertIn('NIMROD_AT_LOGIN must be', r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.home, '.local')))
        self.assertFalse(os.path.exists(os.path.join(self.home, '.config')))


if __name__ == '__main__':
    unittest.main()
