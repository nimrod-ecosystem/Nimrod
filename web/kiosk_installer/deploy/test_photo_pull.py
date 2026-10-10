"""test_photo_pull.py - nimrod-photo-pull.sh, the Drive pull (2026-10-09), with a stand-in rclone.

    py -3.13 -m unittest web/kiosk_installer/deploy/test_photo_pull.py      (or: python3 -m unittest ... on the Pi)

What it proves, without Google and without a Pi: a pull that is not due does nothing; a pull that is not set up, or
whose rclone login could WRITE to Drive, is refused; a drive that is not mounted is refused and nothing is written
where its mount point should be; the default is `rclone copy` (nothing ever deleted) from Drive to the drive, never
the other way; mirroring is `sync` with a backup folder beside the target and a cap; iPhone pictures are converted
only by a converter that is already there, and said so when there is none; last-pull.json counts today's new pictures.

Needs a bash: /bin/bash on Linux, Git for Windows' bash on Windows (never the WSL launcher in System32). Skips without.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'nimrod-photo-pull.sh')


def find_bash():
    if os.name != 'nt':
        return shutil.which('bash')
    for p in (r'C:\Program Files\Git\bin\bash.exe', r'C:\Program Files\Git\usr\bin\bash.exe'):
        if os.path.exists(p):
            return p
    return None


BASH = find_bash()


def posix(p):
    """A path as the bash running the script sees it (Git bash: C:\\a\\b -> /c/a/b)."""
    if os.name != 'nt':
        return p
    drive, rest = os.path.splitdrive(os.path.abspath(p))
    return '/' + drive[0].lower() + rest.replace('\\', '/')


STUB_RCLONE = r'''#!/bin/bash
echo "$*" >> "$FAKE_RCLONE_LOG"
if [ "$1" = config ] && [ "$2" = show ]; then
  [ "${FAKE_CONF_RC:-0}" = 0 ] || exit 1
  printf '[%s]\ntype = %s\nscope = %s\n' "$3" "${FAKE_TYPE-drive}" "${FAKE_SCOPE-drive.readonly}"
  exit 0
fi
dest="$3"; logf=""; prev=""
for a in "$@"; do [ "$prev" = "--log-file" ] && logf="$a"; prev="$a"; done
case "$dest" in
  */.nimrod-pull/heic)
    if [ -n "${FAKE_HEIC:-}" ]; then mkdir -p "$dest"; echo heic > "$dest/$FAKE_HEIC"; echo "INFO  : $FAKE_HEIC: Copied (new)" >> "$logf"; fi ;;
  *)
    i=0; while [ "$i" -lt "${FAKE_NEW:-0}" ]; do i=$((i + 1)); echo "2026/10/09 03:00:01 INFO  : p$i.jpg: Copied (new)" >> "$logf"; done ;;
esac
exit "${FAKE_RC:-0}"
'''
STUB_MOUNTPOINT = '#!/bin/bash\n[ "${FAKE_MOUNTED:-1}" = 1 ]\n'
STUB_FINDMNT = '#!/bin/bash\necho "${FAKE_FINDMNT:-/media/drive}"\n'
STUB_HEIF = '#!/bin/bash\n# heif-convert [-q N] in out\nwhile [ "$1" = -q ]; do shift 2; done\ncp "$1" "$2"\n'


@unittest.skipUnless(BASH, 'no bash here (Git for Windows, or /bin/bash)')
class PhotoPullTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='photopull-')
        self.bin = os.path.join(self.tmp, 'bin')
        self.bin_noconv = os.path.join(self.tmp, 'bin-noconv')
        for d in (self.bin, self.bin_noconv):
            os.makedirs(d)
            for name, body in (('mountpoint', STUB_MOUNTPOINT), ('findmnt', STUB_FINDMNT)):
                self._stub(os.path.join(d, name), body)
        self._stub(os.path.join(self.bin, 'heif-convert'), STUB_HEIF)
        self.rclone = os.path.join(self.tmp, 'rclone-stub')
        self._stub(self.rclone, STUB_RCLONE)
        self.drive = os.path.join(self.tmp, 'drive')
        self.target = os.path.join(self.drive, 'photos', 'family_drive')
        os.makedirs(os.path.join(self.drive, 'photos'))
        self.calls = os.path.join(self.tmp, 'rclone-calls.txt')
        self.state = os.path.join(self.tmp, 'state')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    @staticmethod
    def _stub(path, body):
        with open(path, 'w', newline='\n', encoding='utf-8') as f:
            f.write(body)
        os.chmod(path, 0o755)

    def run_pull(self, *args, conv=True, **env):
        e = dict(os.environ)
        for k in list(e):
            if k.startswith('NIMROD_PULL_') or k.startswith('FAKE_'):
                del e[k]
        e.update({
            'NIMROD_PULL_REMOTE': 'nimrod-photos:',
            'NIMROD_PULL_TARGET': posix(self.target),
            'NIMROD_PULL_MOUNT': posix(self.drive),
            'NIMROD_PULL_RCLONE': posix(self.rclone),
            'NIMROD_PULL_STATE_DIR': posix(self.state),
            'FAKE_RCLONE_LOG': posix(self.calls),
            'PATH': (self.bin if conv else self.bin_noconv) + os.pathsep + os.environ.get('PATH', ''),
        })
        e.update({k: str(v) for k, v in env.items()})
        p = subprocess.run([BASH, posix(SCRIPT), *args], env=e, capture_output=True, text=True, timeout=60)
        return p.returncode, (p.stdout + p.stderr).strip()

    def rclone_calls(self, verb=None):
        if not os.path.exists(self.calls):
            return []
        with open(self.calls, encoding='utf-8') as f:
            lines = [ln.split() for ln in f.read().splitlines() if ln.strip()]
        return [ln for ln in lines if verb is None or ln[0] == verb]

    def status(self):
        with open(os.path.join(self.target, '.nimrod-pull', 'last-pull.json'), encoding='utf-8') as f:
            return json.load(f)

    # ---- the guards
    def test_not_set_up_is_refused_and_says_what_is_missing(self):
        rc, out = self.run_pull('--now', NIMROD_PULL_REMOTE='')
        self.assertEqual(rc, 2, out)
        self.assertIn('NIMROD_PULL_REMOTE is empty', out)
        rc, out = self.run_pull('--now', NIMROD_PULL_TARGET='relative/path')
        self.assertEqual(rc, 2, out)
        self.assertIn('not a full path', out)

    def test_a_login_that_could_write_to_drive_is_refused(self):
        rc, out = self.run_pull('--now', FAKE_SCOPE='drive')
        self.assertEqual(rc, 2, out)
        self.assertIn('can write to Drive', out)
        self.assertEqual(self.rclone_calls('copy') + self.rclone_calls('sync'), [], 'nothing copied')
        rc, out = self.run_pull('--now', FAKE_SCOPE='')
        self.assertEqual(rc, 2, 'no scope line means the full drive scope: refused')

    def test_not_google_drive_is_refused(self):
        rc, out = self.run_pull('--now', FAKE_TYPE='s3')
        self.assertEqual(rc, 2, out)
        self.assertIn('not Google Drive', out)

    def test_an_unknown_remote_is_refused(self):
        rc, out = self.run_pull('--now', FAKE_CONF_RC=1)
        self.assertEqual(rc, 2, out)
        self.assertIn("no remote called 'nimrod-photos'", out)

    def test_a_drive_that_is_not_mounted_is_refused_and_nothing_is_written(self):
        shutil.rmtree(self.drive)
        rc, out = self.run_pull('--now', FAKE_MOUNTED=0)
        self.assertEqual(rc, 3, out)
        self.assertIn('not mounted', out)
        self.assertFalse(os.path.exists(self.drive), 'the mount point was not made on the system card')
        self.assertEqual(self.rclone_calls('copy'), [])

    def test_without_a_mount_given_the_target_must_not_be_on_the_system_card(self):
        rc, out = self.run_pull('--now', NIMROD_PULL_MOUNT='', FAKE_FINDMNT='/')
        self.assertEqual(rc, 3, out)
        rc, out = self.run_pull('--now', NIMROD_PULL_MOUNT='', FAKE_FINDMNT='/', NIMROD_PULL_ALLOW_SYSTEM_DISK=1)
        self.assertEqual(rc, 0, out)

    def test_a_target_outside_the_mount_is_refused(self):
        rc, out = self.run_pull('--now', NIMROD_PULL_MOUNT='/somewhere/else')
        self.assertEqual(rc, 2, out)
        self.assertIn('not inside NIMROD_PULL_MOUNT', out)

    def test_bad_settings_are_refused(self):
        for k, v, said in (('NIMROD_PULL_EVERY', 'fortnightly', 'hourly, daily, weekly or manual'),
                           ('NIMROD_PULL_HOUR', '25', 'an hour'), ('NIMROD_PULL_MIRROR_DELETES', 'yes', '0 or 1'),
                           ('NIMROD_PULL_CONVERT_HEIC', 'maybe', 'auto or off')):
            rc, out = self.run_pull('--now', **{k: v})
            self.assertEqual(rc, 2, f'{k}={v}: {out}')
            self.assertIn(said, out)

    def test_a_backup_folder_inside_the_target_is_refused(self):
        rc, out = self.run_pull('--now', NIMROD_PULL_MIRROR_DELETES=1,
                                NIMROD_PULL_BACKUP_DIR=posix(os.path.join(self.target, 'old')))
        self.assertEqual(rc, 2, out)
        self.assertIn('beside it', out)

    # ---- what it runs
    def test_the_default_is_copy_from_drive_to_the_drive_and_nothing_deleted(self):
        rc, out = self.run_pull('--now', FAKE_NEW=3)
        self.assertEqual(rc, 0, out)
        copies = self.rclone_calls('copy')
        self.assertEqual(len(copies), 2, 'the pictures, then the iPhone originals')
        self.assertEqual(self.rclone_calls('sync'), [], 'never sync by default')
        main = copies[0]
        self.assertEqual(main[1], 'nimrod-photos:', 'Drive is the SOURCE')
        self.assertEqual(main[2], posix(self.target), 'the drive is the destination')
        self.assertNotIn('--backup-dir', main)
        for flag in ('--ignore-case', '--drive-skip-gdocs', '--bwlimit', '--filter-from'):
            self.assertIn(flag, main)
        self.assertIn('3 new pictures, 0 changed, 0 set aside', out)
        self.assertIn('(copy,', out)
        s = self.status()
        self.assertEqual((s['new'], s['new_today'], s['ok'], s['mode']), (3, 3, True, 'copy'), s)

    def test_new_pictures_today_add_up_and_a_pull_not_due_does_nothing(self):
        self.run_pull('--now', FAKE_NEW=2)
        self.run_pull('--now', FAKE_NEW=1)
        self.assertEqual(self.status()['new_today'], 3)
        n = len(self.rclone_calls())
        rc, out = self.run_pull()                       # daily, and it already pulled today
        self.assertEqual((rc, out), (0, ''), 'not due: silent')
        self.assertEqual(len(self.rclone_calls()), n, 'not due: rclone not even asked')
        rc, out = self.run_pull(NIMROD_PULL_EVERY='manual')
        self.assertEqual((rc, out), (0, ''))

    def test_mirroring_is_sync_with_a_backup_folder_beside_the_target_and_a_cap(self):
        rc, out = self.run_pull('--now', NIMROD_PULL_MIRROR_DELETES=1)
        self.assertEqual(rc, 0, out)
        main = self.rclone_calls('sync')[0]
        bd = main[main.index('--backup-dir') + 1]
        self.assertTrue(bd.startswith(posix(os.path.join(self.drive, 'photos', '.nimrod-removed', 'family_drive'))), bd)
        self.assertEqual(main[main.index('--max-delete') + 1], '50')

    def test_a_failed_rclone_is_said_and_retried_next_time(self):
        rc, out = self.run_pull('--now', FAKE_RC=1)
        self.assertEqual(rc, 4, out)
        self.assertIn('did not finish', out)
        self.assertFalse(self.status()['ok'])
        self.assertFalse(os.path.exists(os.path.join(self.state, 'last-success')), 'not marked done: the next look tries again')

    def test_dry_run_and_check_change_nothing(self):
        rc, out = self.run_pull('--dry-run')
        self.assertEqual(rc, 0, out)
        self.assertIn('would run:', out)
        self.assertEqual(self.rclone_calls('copy'), [])
        self.assertFalse(os.path.exists(os.path.join(self.target, '.nimrod-pull', 'last-pull.json')))
        rc, out = self.run_pull('--check')
        self.assertEqual(rc, 0, out)
        self.assertIn('ready:', out)
        self.assertIn('HEIC converter: heif-convert', out)

    # ---- iPhone pictures
    def test_heic_is_converted_by_a_converter_that_is_here_and_kept_aside(self):
        rc, out = self.run_pull('--now', FAKE_HEIC='IMG_1.HEIC')
        self.assertEqual(rc, 0, out)
        self.assertTrue(os.path.exists(os.path.join(self.target, 'IMG_1.HEIC.jpg')), os.listdir(self.target))
        self.assertTrue(os.path.exists(os.path.join(self.target, '.nimrod-pull', 'heic', 'IMG_1.HEIC')))
        self.assertIn('1 converted from HEIC with heif-convert', out)
        self.assertEqual(self.status()['new'], 1)

    def test_heic_with_no_converter_is_kept_aside_and_said(self):
        rc, out = self.run_pull('--now', conv=False, FAKE_HEIC='IMG_2.HEIC')
        self.assertEqual(rc, 0, out)
        self.assertFalse(os.path.exists(os.path.join(self.target, 'IMG_2.HEIC.jpg')))
        self.assertIn('not shown: no converter here', out)
        self.assertEqual(self.status()['heic_not_shown'], 1)

    def test_heic_off_does_not_fetch_them(self):
        rc, out = self.run_pull('--now', NIMROD_PULL_CONVERT_HEIC='off', FAKE_HEIC='IMG_3.HEIC')
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(self.rclone_calls('copy')), 1)

    def test_the_script_has_lf_line_endings(self):
        with open(SCRIPT, 'rb') as f:
            self.assertNotIn(b'\r\n', f.read(), 'CRLF breaks the shebang on the Pi')


if __name__ == '__main__':
    unittest.main()
