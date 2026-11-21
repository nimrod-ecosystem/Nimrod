"""test_login_mode.py - nimrod-login-mode.sh and kiosk-launch.sh's window modes (2026-11-20, row 2.273).

    py -3.13 -m unittest web/kiosk_installer/deploy/test_login_mode.py      (or: python3 -m unittest ... on the Pi)

What it proves, without a Pi: choosing `window` writes a browser unit from the kiosk unit's own settings that never
relaunches, disables the kiosk unit, and changes only the Nimrod line of autostart (a backup kept, every other line kept);
`kiosk` turns it back; `none` leaves nothing of Nimrod's at login; `--now` stops one and starts the other. And the launcher:
a window is an ordinary Chromium (no --kiosk, never --use-fake-ui-for-media-stream), with the same address as the kiosk;
autoplay is passed only while the site-only policy is missing; a kiosk started into an open browser exits 75 (not
relaunched) instead of opening a tab every 3 seconds; a stale lock is still cleared.

Needs a bash: /bin/bash on Linux, Git for Windows' bash on Windows (never the WSL launcher in System32). Skips without.
The two lock tests need real symlinks, so they skip where bash cannot make one (Git bash without developer mode).
"""
import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
MODE_SCRIPT = os.path.join(HERE, 'nimrod-login-mode.sh')
LAUNCH = os.path.join(HERE, 'kiosk-launch.sh')


def find_bash():
    if os.name != 'nt':
        return shutil.which('bash')
    for p in (r'C:\Program Files\Git\bin\bash.exe', r'C:\Program Files\Git\usr\bin\bash.exe'):
        if os.path.exists(p):
            return p
    return None


BASH = find_bash()


def posix(p):
    if os.name != 'nt':
        return p
    drive, rest = os.path.splitdrive(os.path.abspath(p))
    return '/' + drive[0].lower() + rest.replace('\\', '/')


KIOSK_UNIT = """[Unit]
Description=Nimrod kiosk
After=graphical-session.target

[Service]
Type=simple
Environment=NIMROD_KIOSK_URL=https://site.example/kiosk.html?pair=key
Environment=NIMROD_LOCAL_VOICE=on
ExecStart=/home/u/.local/bin/nimrod-kiosk-launch.sh
Restart=always
RestartSec=3
Environment=NIMROD_LOCK_HELPER_URL=http://127.0.0.1:8765/screen-lock
RestartPreventExitStatus=75
SuccessExitStatus=75

[Install]
WantedBy=graphical-session.target
"""

AUTOSTART = """# a line of somebody's own
wlr-randr --output HDMI-A-1 --scale 1
systemctl --user daemon-reload
systemctl --user start nimrod-kiosk.service
"""

STUB_SYSTEMCTL = r'''#!/bin/bash
echo "$*" >> "$FAKE_LOG"
case "$*" in
  *is-enabled*) [ "${FAKE_STILL_ENABLED:-0}" = 1 ] && echo enabled || echo disabled ;;
  *is-active*) [ "${FAKE_INACTIVE:-0}" = 1 ] && exit 3 ;;
esac
exit 0
'''
STUB_CHROMIUM = '#!/bin/bash\nfor a in "$@"; do echo "$a"; done > "$FAKE_CHROMIUM_ARGS"\nexit 0\n'
STUB_CURL = '#!/bin/bash\nexit 0\n'


@unittest.skipIf(BASH is None, 'no bash here')
class LoginModeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = os.path.join(self.tmp, 'home')
        self.units = os.path.join(self.home, '.config', 'systemd', 'user')
        os.makedirs(self.units)
        os.makedirs(os.path.join(self.home, '.config', 'labwc'))
        with open(os.path.join(self.units, 'nimrod-kiosk.service'), 'w', newline='\n') as f:
            f.write(KIOSK_UNIT)
        self.autostart = os.path.join(self.home, '.config', 'labwc', 'autostart')
        with open(self.autostart, 'w', newline='\n') as f:
            f.write(AUTOSTART)
        self.log = os.path.join(self.tmp, 'systemctl.log')
        self.stub = os.path.join(self.tmp, 'systemctl')
        with open(self.stub, 'w', newline='\n') as f:
            f.write(STUB_SYSTEMCTL)
        os.chmod(self.stub, 0o755)

    def run_mode(self, *args, **fake):
        env = dict(os.environ, HOME=posix(self.home), NIMROD_SYSTEMCTL=posix(self.stub), FAKE_LOG=posix(self.log),
                   NIMROD_NOW_WAIT_S='0', **fake)
        return subprocess.run([BASH, posix(MODE_SCRIPT), *args], env=env, capture_output=True, text=True)

    def dropin(self):
        return os.path.join(self.units, 'nimrod-lock-helper.service.d', 'watch.conf')

    def read(self, *parts):
        with open(os.path.join(*parts)) as f:
            return f.read()

    def calls(self):
        return self.read(self.log).splitlines() if os.path.exists(self.log) else []

    def test_window_writes_a_browser_unit_from_the_kiosks_settings_that_comes_back_only_after_a_crash(self):
        r = self.run_mode('window')
        self.assertEqual(r.returncode, 0, r.stderr)
        unit = self.read(self.units, 'nimrod-browser.service')
        for line in ('Environment=NIMROD_KIOSK_URL=https://site.example/kiosk.html?pair=key',
                     'Environment=NIMROD_LOCAL_VOICE=on',
                     'Environment=NIMROD_LOCK_HELPER_URL=http://127.0.0.1:8765/screen-lock',
                     'Environment=NIMROD_LAUNCH_MODE=window',
                     'ExecStart=/home/u/.local/bin/nimrod-kiosk-launch.sh',
                     'Restart=on-failure'):
            self.assertIn(line, unit.splitlines())
        self.assertNotIn('Restart=always', unit)     # a person closing it is not relaunched
        self.assertIn('--user disable nimrod-kiosk.service', self.calls())

    def test_the_watchdog_follows_the_window_unless_told_not_to(self):
        self.run_mode('window')
        self.assertIn('Environment=NIMROD_KIOSK_UNIT=nimrod-browser.service', self.read(self.dropin()).splitlines())
        self.run_mode('window', '--no-watch')
        self.assertFalse(os.path.exists(self.dropin()))
        self.run_mode('fullscreen')
        self.assertTrue(os.path.exists(self.dropin()))
        self.run_mode('kiosk')
        self.assertFalse(os.path.exists(self.dropin()))

    def test_a_kiosk_left_enabled_stops_it_before_autostart_changes(self):
        r = self.run_mode('window', FAKE_STILL_ENABLED='1')
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.read(self.autostart), AUTOSTART)

    def test_now_says_so_when_the_unit_did_not_start(self):
        r = self.run_mode('kiosk', '--now', FAKE_INACTIVE='1')
        self.assertEqual(r.returncode, 1)
        self.assertIn('close it first', r.stderr)

    def test_a_start_line_inside_a_longer_line_goes_too(self):
        with open(self.autostart, 'a', newline='\n') as f:
            f.write('systemctl --user daemon-reload && systemctl --user start nimrod-kiosk.service  # mine\n')
        self.run_mode('window')
        text = self.read(self.autostart)
        self.assertNotIn('nimrod-kiosk.service', text)
        self.assertEqual(text.count('systemctl --user start nimrod-browser.service'), 1)

    def test_window_changes_only_the_nimrod_line_of_autostart_and_keeps_a_backup(self):
        self.run_mode('window')
        lines = self.read(self.autostart).splitlines()
        self.assertIn('wlr-randr --output HDMI-A-1 --scale 1', lines)
        self.assertIn('# a line of somebody\'s own', lines)
        self.assertIn('systemctl --user start nimrod-browser.service', lines)
        self.assertNotIn('systemctl --user start nimrod-kiosk.service', lines)
        backups = [n for n in os.listdir(os.path.dirname(self.autostart)) if n.startswith('autostart.bak.')]
        self.assertEqual(len(backups), 1)

    def test_kiosk_turns_it_back(self):
        self.run_mode('window')
        self.run_mode('kiosk')
        lines = self.read(self.autostart).splitlines()
        self.assertEqual(lines.count('systemctl --user start nimrod-kiosk.service'), 1)
        self.assertNotIn('systemctl --user start nimrod-browser.service', lines)
        self.assertIn('--user enable nimrod-kiosk.service', self.calls())

    def test_none_leaves_nothing_of_nimrods_at_login_and_says_so_once(self):
        self.run_mode('none')
        self.run_mode('none')
        text = self.read(self.autostart)
        self.assertNotIn('start nimrod-', text)
        self.assertEqual(text.count("nimrod-login-mode.sh none"), 1)
        self.assertIn('--user disable nimrod-kiosk.service', self.calls())

    def test_fullscreen_is_the_window_started_full_screen(self):
        self.run_mode('fullscreen')
        self.assertIn('Environment=NIMROD_LAUNCH_MODE=fullscreen', self.read(self.units, 'nimrod-browser.service').splitlines())

    def test_the_menu_entry_is_nimrod_full_screen(self):
        self.run_mode('window')
        entry = self.read(self.home, '.local', 'share', 'applications', 'nimrod-dashboard.desktop')
        self.assertIn('Name=Nimrod full screen', entry.splitlines())
        self.assertIn('nimrod-kiosk-back.sh', entry)

    def test_now_stops_the_kiosk_and_opens_the_window(self):
        self.run_mode('window', '--now')
        c = self.calls()
        self.assertLess(c.index('--user stop nimrod-kiosk.service'), c.index('--user start nimrod-browser.service'))

    def test_now_back_to_kiosk_closes_the_window_it_opened_first(self):
        self.run_mode('kiosk', '--now')
        c = self.calls()
        self.assertLess(c.index('--user stop nimrod-browser.service'), c.index('--user start nimrod-kiosk.service'))

    def test_a_wrong_word_or_no_kiosk_unit_changes_nothing(self):
        self.assertEqual(self.run_mode('desktop').returncode, 2)
        os.remove(os.path.join(self.units, 'nimrod-kiosk.service'))
        self.assertEqual(self.run_mode('window').returncode, 1)
        self.assertEqual(self.read(self.autostart), AUTOSTART)
        self.assertEqual(self.calls(), [])


@unittest.skipIf(BASH is None, 'no bash here')
class LaunchModeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.bin = os.path.join(self.tmp, 'bin')
        os.makedirs(self.bin)
        for name, body in (('chromium', STUB_CHROMIUM), ('curl', STUB_CURL)):
            p = os.path.join(self.bin, name)
            with open(p, 'w', newline='\n') as f:
                f.write(body)
            os.chmod(p, 0o755)
        self.profile = os.path.join(self.tmp, 'profile')
        os.makedirs(self.profile)
        self.args_file = os.path.join(self.tmp, 'chromium.args')
        self.lock_policy = os.path.join(self.tmp, 'nimrod-lock-helper.json')
        with open(self.lock_policy, 'w') as f:
            f.write('{}')
        self.site_policy = os.path.join(self.tmp, 'nimrod-site.json')    # absent unless a test writes it

    def launch(self, mode=None, extra=None):
        env = dict(os.environ,
                   PATH=posix(self.bin) + ':' + (os.environ.get('PATH', '') if os.name != 'nt' else '/usr/bin:/bin'),
                   NIMROD_KIOSK_URL='https://site.example/kiosk.html', NIMROD_KIOSK_PROFILE=posix(self.profile),
                   NIMROD_LOCK_HELPER_URL='http://127.0.0.1:8765/screen-lock', NIMROD_LOCAL_VOICE='on',
                   NIMROD_LOCK_POLICY_FILE=posix(self.lock_policy), NIMROD_SITE_POLICY_FILE=posix(self.site_policy),
                   FAKE_CHROMIUM_ARGS=posix(self.args_file), NIMROD_NET_WAIT_S='0')
        if mode:
            env['NIMROD_LAUNCH_MODE'] = mode
        env.update(extra or {})
        r = subprocess.run([BASH, posix(LAUNCH)], env=env, capture_output=True, text=True, timeout=60)
        args = None
        if os.path.exists(self.args_file):
            with open(self.args_file) as f:
                args = f.read().splitlines()
            os.remove(self.args_file)
        return r, args

    def test_a_window_is_an_ordinary_chromium_on_the_kiosks_address(self):
        r, args = self.launch('window')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn('--kiosk', args)
        self.assertNotIn('--use-fake-ui-for-media-stream', args)
        self.assertNotIn('--start-fullscreen', args)
        self.assertIn('--start-maximized', args)
        self.assertIn('--no-default-browser-check', args)
        self.assertIn('--noerrdialogs', args)
        self.assertEqual(args[-1], 'https://site.example/kiosk.html?lockHelper=http://127.0.0.1:8765/screen-lock'
                                   '&localVoice=on&boot=1')

    def test_autoplay_only_while_the_site_policy_is_missing(self):
        _, args = self.launch('window')
        self.assertIn('--autoplay-policy=no-user-gesture-required', args)
        with open(self.site_policy, 'w') as f:
            f.write('{}')
        _, args = self.launch('window')
        self.assertNotIn('--autoplay-policy=no-user-gesture-required', args)

    def test_fullscreen_adds_start_fullscreen(self):
        _, args = self.launch('fullscreen')
        self.assertIn('--start-fullscreen', args)
        self.assertNotIn('--kiosk', args)

    def test_the_kiosk_is_unchanged(self):
        r, args = self.launch()
        self.assertEqual(r.returncode, 0, r.stderr)
        for a in ('--kiosk', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'):
            self.assertIn(a, args)

    def test_a_wrong_mode_launches_nothing(self):
        r, args = self.launch('desktop')
        self.assertEqual(r.returncode, 2)
        self.assertIsNone(args)

    def make_lock(self, pid, host=None):
        if not os.path.isdir('/proc'):
            self.skipTest('no /proc here: a lock is never "held" without one')
        target = f'{host or subprocess.run(["hostname"], capture_output=True, text=True).stdout.strip()}-{pid}'
        r = subprocess.run([BASH, '-c', f'ln -s "{target}" "{posix(self.profile)}/SingletonLock" && '
                                        f'[ "$(readlink "{posix(self.profile)}/SingletonLock")" = "{target}" ]'],
                           capture_output=True)
        if r.returncode != 0:
            self.skipTest('this bash cannot make a symlink')

    def live_pid(self, name='chromium'):
        """A live process whose /proc/<pid>/comm is `name` (a copy of `sleep` under that name)."""
        if os.name == 'nt' or not os.path.isdir('/proc') or not shutil.which('sleep'):
            self.skipTest('needs Linux: /proc and a sleep program')
        exe = os.path.join(self.tmp, 'holder', name)
        os.makedirs(os.path.dirname(exe), exist_ok=True)
        shutil.copy(shutil.which('sleep'), exe)
        os.chmod(exe, 0o755)
        p = subprocess.Popen([exe, '30'])
        self.addCleanup(lambda: (p.kill(), p.wait()))
        return p.pid

    def test_a_kiosk_into_an_open_browser_stays_out_instead_of_looping(self):
        self.make_lock(self.live_pid())
        r, args = self.launch()
        self.assertEqual(r.returncode, 75)
        self.assertIsNone(args)
        self.assertTrue(os.path.lexists(os.path.join(self.profile, 'SingletonLock')))

    def test_a_window_into_an_open_browser_opens_there_and_keeps_its_lock(self):
        self.make_lock(self.live_pid())
        r, args = self.launch('window')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIsNotNone(args)
        self.assertTrue(os.path.lexists(os.path.join(self.profile, 'SingletonLock')))

    def test_a_stale_lock_is_still_cleared(self):
        self.make_lock(2 ** 22 + 12345)     # past any pid_max this test runs under
        r, args = self.launch()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('--kiosk', args)
        self.assertFalse(os.path.lexists(os.path.join(self.profile, 'SingletonLock')))

    def test_a_reused_pid_after_a_power_cut_is_not_a_browser(self):
        # The gate's case: the stale lock's pid now belongs to some other program. The kiosk must still start.
        self.make_lock(self.live_pid('sleep'))
        r, args = self.launch()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('--kiosk', args)
        self.assertFalse(os.path.lexists(os.path.join(self.profile, 'SingletonLock')))

    def test_a_lock_from_another_computer_is_not_held_here(self):
        self.make_lock(self.live_pid(), host='some-other-pi')
        r, args = self.launch()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('--kiosk', args)


if __name__ == '__main__':
    unittest.main()
