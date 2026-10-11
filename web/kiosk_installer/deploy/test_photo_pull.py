"""test_photo_pull.py - nimrod-photo-pull.sh, the Drive pull (2026-10-09), with a stand-in rclone.

    py -3.13 -m unittest web/kiosk_installer/deploy/test_photo_pull.py      (or: python3 -m unittest ... on the Pi)

What it proves, without Google and without a Pi: a pull that is not due does nothing; a pull that is not set up, or
whose rclone login could WRITE to Drive, is refused; a drive that is not mounted is refused and nothing is written
where its mount point should be; the default is `rclone copy` (nothing ever deleted) from Drive to the drive, never
the other way; mirroring is `sync` with a backup folder beside the target and a cap; iPhone pictures are converted
only by a converter that is already there, and said so when there is none; last-pull.json counts today's new pictures.

Needs a bash: /bin/bash on Linux, Git for Windows' bash on Windows (never the WSL launcher in System32). Skips without.
"""
import calendar
import glob
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
# findmnt -n -o TARGET -T <path>: "/" (the system card) for a path under FAKE_SYSTEM_PREFIX, else FAKE_FINDMNT.
STUB_FINDMNT = r'''#!/bin/bash
p="$5"
if [ -n "${FAKE_SYSTEM_PREFIX:-}" ]; then case "$p" in "$FAKE_SYSTEM_PREFIX"*) echo /; exit 0 ;; esac; fi
echo "${FAKE_FINDMNT:-/media/drive}"
'''
# df -Pk <path>: the free space is FAKE_DF_AVAIL_K kilobytes (default 100 GB), so the space guard can be driven.
STUB_DF = r'''#!/bin/bash
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
echo "fake 209715200 0 ${FAKE_DF_AVAIL_K:-104857600} 0% /"
'''
STUB_HEIF = '#!/bin/bash\n# heif-convert [-q N] in out\nwhile [ "$1" = -q ]; do shift 2; done\ncp "$1" "$2"\n'


@unittest.skipUnless(BASH, 'no bash here (Git for Windows, or /bin/bash)')
class PhotoPullTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='photopull-')
        self.bin = os.path.join(self.tmp, 'bin')
        self.bin_noconv = os.path.join(self.tmp, 'bin-noconv')
        for d in (self.bin, self.bin_noconv):
            os.makedirs(d)
            for name, body in (('mountpoint', STUB_MOUNTPOINT), ('findmnt', STUB_FINDMNT), ('df', STUB_DF)):
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


# ---------------------------------------------------------------------------------------------------------------------
# THE JOB LIST (2026-10-10, storage roles Stage 1): a local copy job, her drive (the primary) -> a folder on this
# computer's own storage (the fallback). Here the whole job runs for real - find, cp, mv on temp folders - with only the
# drive's mount (mountpoint), where a path lives (findmnt) and the free space (df) stood in for.
T0 = 1_760_000_000          # a fixed "modified" time for the pictures; newer ones are T0 + n


@unittest.skipUnless(BASH, 'no bash here (Git for Windows, or /bin/bash)')
class CopyJobTest(unittest.TestCase):
    setUp_pull = PhotoPullTest.setUp
    tearDown = PhotoPullTest.tearDown
    _stub = staticmethod(PhotoPullTest._stub)
    run_pull = PhotoPullTest.run_pull
    rclone_calls = PhotoPullTest.rclone_calls

    def setUp(self):
        self.setUp_pull()
        self.primary = os.path.join(self.drive, 'Cici', 'photos')       # the drive's media agent's folder
        self.sd = os.path.join(self.tmp, 'sd')                           # stands for the system card
        self.fallback = os.path.join(self.sd, 'home', 'u', 'nimrod-fallback')
        os.makedirs(self.primary)
        os.makedirs(os.path.dirname(self.fallback))     # the home folder is there; the fallback folder is made by the job

    def pic(self, rel, age=0, size=100, root=None):
        """A picture under the primary (or `root`), `age` seconds newer than T0."""
        p = os.path.join(root or self.primary, *rel.split('/'))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f:
            f.write(b'x' * size)
        os.utime(p, (T0 + age, T0 + age))
        return p

    def run_job(self, *args, **env):
        base = {
            'NIMROD_PULL_JOBS': 'fallback',
            'NIMROD_PULL_JOB_FALLBACK_FROM': posix(self.primary),
            'NIMROD_PULL_JOB_FALLBACK_FROM_MOUNT': posix(self.drive),
            'NIMROD_PULL_JOB_FALLBACK_TO': posix(self.fallback),
            'NIMROD_PULL_JOB_FALLBACK_ALLOW_SYSTEM_DISK': 1,
            'FAKE_SYSTEM_PREFIX': posix(self.sd),
            'NIMROD_PULL_DF': posix(os.path.join(self.bin, 'df')),      # Git bash puts its own df first on PATH
        }
        base.update(env)
        return self.run_pull(*args, **base)

    def in_fallback(self, rel=''):
        return os.path.join(self.fallback, *rel.split('/')) if rel else self.fallback

    def fallback_pictures(self):
        out = []
        for d, dirs, files in os.walk(self.fallback):
            dirs[:] = [x for x in dirs if not x.startswith('.')]
            out += [os.path.relpath(os.path.join(d, f), self.fallback).replace('\\', '/') for f in files if not f.startswith('.')]
        return sorted(out)

    def job_status(self, name='fallback'):
        with open(os.path.join(self.fallback, '.nimrod-pull', f'last-{name}.json'), encoding='utf-8') as f:
            return json.load(f)

    # ---- off by default, and nothing else changes
    def test_no_job_list_is_the_drive_pull_alone_as_before(self):
        self.pic('a.jpg')
        env = {'NIMROD_PULL_JOB_FALLBACK_FROM': posix(self.primary), 'NIMROD_PULL_JOB_FALLBACK_TO': posix(self.fallback),
               'NIMROD_PULL_JOB_FALLBACK_ALLOW_SYSTEM_DISK': 1, 'FAKE_NEW': 2}
        rc, out = self.run_pull('--now', **env)                 # every fallback setting there, but no NIMROD_PULL_JOBS
        self.assertEqual(rc, 0, out)
        self.assertEqual(out.splitlines()[-1].split(' (')[0], '2 new pictures, 0 changed, 0 set aside', 'job 1 alone, its line as before')
        self.assertNotIn('fallback', out)
        self.assertFalse(os.path.exists(self.fallback), 'the fallback job is OFF until NIMROD_PULL_JOBS names it')
        self.assertEqual(len(self.rclone_calls('copy')), 2)
        s = PhotoPullTest.status(self)
        self.assertEqual((s['new'], s['new_today'], s['mode']), (2, 2, 'copy'), s)
        self.assertEqual((s['job'], s['role'], s['from_role']), ('drive', 'primary', 'sync'), 'job 1 now says its role too')
        self.assertIsInstance(s['free_bytes'], int)
        self.assertEqual(s['every'], 'daily', 'says how often it runs, so Devices > Storage knows when a copy is late')

    # ---- what it copies
    def test_the_fallback_job_copies_pictures_from_the_primary(self):
        self.pic('a.jpg', 1); self.pic('Family/b.JPG', 2); self.pic('c.png', 3)
        self.pic('film.mp4', 4)                                  # not a picture: not copied by default
        self.pic('.nimrod-pull/heic/IMG.HEIC', 5)                # job 1's iPhone originals: a dot-folder, left out
        self.pic('.hidden.jpg', 6)
        rc, out = self.run_job('--now')
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.fallback_pictures(), ['Family/b.JPG', 'a.jpg', 'c.png'])
        self.assertFalse(os.path.exists(self.in_fallback('.nimrod-pull/heic')))
        self.assertEqual(int(os.path.getmtime(self.in_fallback('Family/b.JPG'))), T0 + 2, 'the time kept, so a re-run skips it')
        self.assertIn('fallback: 3 new pictures, 0 changed, 0 set aside', out)
        s = self.job_status()
        self.assertEqual((s['job'], s['role'], s['from_role'], s['mode'], s['limit']), ('fallback', 'fallback', 'primary', 'copy', 'newest:1000'))
        self.assertEqual((s['new'], s['changed'], s['removed'], s['left_for_space'], s['files'], s['ok']), (3, 0, 0, 0, 3, True), s)
        self.assertEqual(s['free_bytes'], 104857600 * 1024)
        self.assertEqual(s['keep_free_bytes'], 2048 * 1048576)
        self.assertEqual(s['every'], 'daily', 'says how often it runs, so Devices > Storage knows when a copy is late')
        self.assertFalse(os.path.exists(self.in_fallback('.nimrod-pull/last-pull.json')),
                         "never job 1's file: the Photos panel would say 'new pictures today' about a backup copy")
        self.assertEqual(self.rclone_calls(), [], 'a local job needs no rclone')

    def test_a_second_run_copies_only_what_is_new_or_changed(self):
        self.pic('a.jpg', 1); self.pic('b.jpg', 2)
        self.run_job('--now')
        self.pic('c.jpg', 3)
        self.pic('a.jpg', 9, size=200)                           # edited on the drive
        rc, out = self.run_job('--now')
        self.assertEqual(rc, 0, out)
        self.assertIn('fallback: 1 new picture, 1 changed', out)
        self.assertEqual(os.path.getsize(self.in_fallback('a.jpg')), 200)

    def test_newest_n_copies_only_the_newest(self):
        for i in range(5):
            self.pic(f'p{i}.jpg', i)
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_LIMIT='newest:2')
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.fallback_pictures(), ['p3.jpg', 'p4.jpg'])

    def test_one_album(self):
        self.pic('Family/2025/a.jpg', 1); self.pic('Family/b.jpg', 2); self.pic('c.jpg', 3)
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_LIMIT='album:Family/2025')
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.fallback_pictures(), ['Family/2025/a.jpg'], 'the same path as on the drive, so albums match')
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_LIMIT='album:../x')
        self.assertEqual(rc, 2, out)
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_LIMIT='album:Nope')
        self.assertEqual(rc, 2, out)
        self.assertIn('not in', out)

    # ---- the space guard
    def test_the_space_guard_refuses_rather_than_fill_the_card(self):
        self.pic('a.jpg', 1)
        rc, out = self.run_job('--now', FAKE_DF_AVAIL_K=1024 * 1024)      # 1 GB free; it keeps 2 GB by default
        self.assertEqual(rc, 6, out)
        self.assertIn('no room', out)
        self.assertEqual(self.fallback_pictures(), [], 'nothing copied')
        s = self.job_status()
        self.assertFalse(s['ok'])
        self.assertEqual(s['left_for_space'], 1)
        self.assertFalse(os.path.exists(os.path.join(self.state, 'last-success-fallback')), 'tried again next time')

    def test_the_space_guard_copies_the_newest_that_fit(self):
        for i in range(3):
            self.pic(f'p{i}.jpg', i, size=1500)
        # 1 MB kept free; 1027 KB free leaves 3072 bytes of room: two 1500-byte pictures, not three
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_KEEP_FREE_MB=1, FAKE_DF_AVAIL_K=1027)
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.fallback_pictures(), ['p1.jpg', 'p2.jpg'], 'the newest first')
        self.assertIn('1 left out: no room', out)
        self.assertEqual(self.job_status()['left_for_space'], 1)

    # ---- removals
    def test_copy_never_removes(self):
        a = self.pic('a.jpg', 1); self.pic('b.jpg', 2)
        self.run_job('--now')
        os.remove(a)
        rc, out = self.run_job('--now')
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.fallback_pictures(), ['a.jpg', 'b.jpg'], 'gone from the drive, kept in the copy')
        self.assertFalse(os.path.exists(os.path.join(self.sd, 'home', 'u', '.nimrod-removed')))

    def test_mirror_moves_a_removed_picture_beside_the_target(self):
        a = self.pic('Family/a.jpg', 1); self.pic('b.jpg', 2); self.pic('c.jpg', 3)
        self.run_job('--now')
        os.remove(a)
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_MIRROR_DELETES=1, NIMROD_PULL_JOB_FALLBACK_LIMIT='newest:1')
        self.assertEqual(rc, 0, out)
        self.assertIn('1 set aside', out)
        self.assertEqual(self.fallback_pictures(), ['b.jpg', 'c.jpg'],
                         'b.jpg is outside the newest 1 but still on the drive: not a removal, so it stays')
        moved = glob.glob(os.path.join(self.sd, 'home', 'u', '.nimrod-removed', 'nimrod-fallback', '*', 'Family', 'a.jpg'))
        self.assertEqual(len(moved), 1, 'moved, never deleted, beside the target as job 1 does')
        self.assertEqual(self.job_status()['mode'], 'mirror')

    def test_mirror_stops_past_its_cap(self):
        files = [self.pic(f'p{i}.jpg', i) for i in range(4)]
        self.run_job('--now')
        for f in files[:3]:
            os.remove(f)
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_MIRROR_DELETES=1, NIMROD_PULL_JOB_FALLBACK_MAX_DELETE=2)
        self.assertEqual(rc, 4, out)
        self.assertIn('more than', out)
        self.assertEqual(len(self.fallback_pictures()), 4, 'none set aside')

    # ---- the guards
    def test_the_system_disk_guard_is_for_this_job_alone(self):
        self.pic('a.jpg', 1)
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_ALLOW_SYSTEM_DISK='', NIMROD_PULL_ALLOW_SYSTEM_DISK=1)
        self.assertEqual(rc, 2, "job 1's NIMROD_PULL_ALLOW_SYSTEM_DISK does not let the copy job onto the card: " + out)
        self.assertIn('ALLOW_SYSTEM_DISK=1', out)
        self.assertFalse(os.path.exists(self.fallback))
        rc, out = self.run_job('--now')
        self.assertEqual(rc, 0, out)
        # and the copy job's own permission never reaches job 1: its target on the card is still refused
        rc, out = self.run_pull('--now', NIMROD_PULL_MOUNT='', FAKE_FINDMNT='/', NIMROD_PULL_JOB_FALLBACK_ALLOW_SYSTEM_DISK=1)
        self.assertEqual(rc, 3, out)

    def test_the_primary_not_mounted_or_empty_is_refused(self):
        self.pic('a.jpg', 1)
        rc, out = self.run_job('--now', FAKE_MOUNTED=0)
        self.assertEqual(rc, 3, out)
        self.assertIn('not mounted', out)
        self.assertFalse(os.path.exists(self.fallback))
        os.remove(os.path.join(self.primary, 'a.jpg'))
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_MIRROR_DELETES=1)
        self.assertEqual(rc, 3, 'an empty primary is never copied, above all never mirrored: ' + out)
        self.assertIn('no pictures', out)
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_FROM_MOUNT='', FAKE_SYSTEM_PREFIX=posix(self.tmp))
        self.assertEqual(rc, 3, 'without a mount given, the primary must not be on the card: ' + out)

    def test_bad_settings_are_refused(self):
        self.pic('a.jpg', 1)
        for k, v, said in (('LIMIT', 'some', 'all, newest:<number> or album:<folder>'), ('LIMIT', 'newest:0', 'above 0'),
                           ('KEEP_FREE_MB', 'lots', 'megabytes'), ('MIRROR_DELETES', 'yes', '0 or 1'),
                           ('EVERY', 'often', 'hourly, daily'), ('UNTIL', '24', '0 to 23, or none'),
                           ('EXTENSIONS', 'j.pg', 'endings'), ('TO', 'relative', 'not a full path')):
            rc, out = self.run_job('--now', **{f'NIMROD_PULL_JOB_FALLBACK_{k}': v})
            self.assertEqual(rc, 2, f'{k}={v}: {out}')
            self.assertIn(said, out)
        rc, out = self.run_job('--now', NIMROD_PULL_JOB_FALLBACK_TO=posix(os.path.join(self.primary, 'copy')))
        self.assertEqual(rc, 2, out)
        for jobs in ('Fallback', 'drive drive', '9x'):
            rc, out = self.run_job('--now', NIMROD_PULL_JOBS=jobs)
            self.assertEqual(rc, 2, f'{jobs}: {out}')

    # ---- when
    def test_nightly_by_default(self):
        self.pic('a.jpg', 1)
        day = calendar.timegm((2026, 10, 10, 0, 0, 0))
        at = lambda d, h, m=0: str(day + d * 86400 + h * 3600 + m * 60)
        rc, out = self.run_job(NIMROD_PULL_TEST_CLOCK=at(0, 14), TZ='UTC')
        self.assertEqual((rc, out), (0, ''), 'mid-afternoon: not due, silent')
        self.assertFalse(os.path.exists(self.fallback))
        rc, out = self.run_job(NIMROD_PULL_TEST_CLOCK=at(0, 3, 20), TZ='UTC')
        self.assertEqual(rc, 0, out)
        self.assertIn('fallback: 1 new picture', out)
        rc, out = self.run_job(NIMROD_PULL_TEST_CLOCK=at(0, 4, 20), TZ='UTC')
        self.assertEqual((rc, out), (0, ''), 'already done tonight')
        rc, out = self.run_job(NIMROD_PULL_TEST_CLOCK=at(1, 8), TZ='UTC')
        self.assertEqual((rc, out), (0, ''), 'the next morning, past the window: waits for the night')
        rc, out = self.run_job(NIMROD_PULL_TEST_CLOCK=at(1, 3, 5), TZ='UTC')
        self.assertEqual(rc, 0, out)
        self.assertIn('fallback: 0 new pictures', out)
        # a window past midnight: 22 to 6 belongs to the night it started
        env = {'NIMROD_PULL_JOB_FALLBACK_HOUR': 22, 'NIMROD_PULL_JOB_FALLBACK_UNTIL': 6, 'TZ': 'UTC'}
        os.remove(os.path.join(self.state, 'last-success-fallback'))
        self.assertIn('fallback:', self.run_job(NIMROD_PULL_TEST_CLOCK=at(2, 23), **env)[1])
        self.assertEqual(self.run_job(NIMROD_PULL_TEST_CLOCK=at(3, 2), **env), (0, ''), 'still the same night')
        self.assertIn('fallback:', self.run_job(NIMROD_PULL_TEST_CLOCK=at(3, 22, 30), **env)[1])

    # ---- the list
    def test_both_jobs_in_order_and_one_failing_does_not_stop_the_other(self):
        self.pic('a.jpg', 1)
        rc, out = self.run_job('--now', NIMROD_PULL_JOBS='drive fallback', FAKE_NEW=1)
        self.assertEqual(rc, 0, out)
        lines = out.splitlines()
        self.assertTrue(lines[0].startswith('1 new picture'), out)
        self.assertTrue(lines[-1].startswith('fallback: 1 new picture'), out)
        rc, out = self.run_job('--now', NIMROD_PULL_JOBS='drive,fallback', NIMROD_PULL_REMOTE='')
        self.assertEqual(rc, 2, "the first job's failure is the run's: " + out)
        self.assertIn('NIMROD_PULL_REMOTE is empty', out)
        self.assertIn('fallback: 0 new pictures', out, 'the copy job still ran')

    def test_dry_run_and_check_change_nothing(self):
        self.pic('a.jpg', 1)
        rc, out = self.run_job('--dry-run')
        self.assertEqual(rc, 0, out)
        self.assertIn('would copy (fallback): 1 of 1 pictures', out)
        rc, out = self.run_job('--check')
        self.assertEqual(rc, 0, out)
        self.assertIn('ready (fallback):', out)
        self.assertIn('keeps 2048 MB free', out)
        self.assertFalse(os.path.exists(self.fallback))


# ---------------------------------------------------------------------------------------------------------------------
# "REMOVE THIS PICTURE" (2026-10-10): the media agent moves a removed picture into <its folder>/.nimrod-removed/<date>/
# and lists it in .nimrod-removed/removed-paths.txt. A stand-in for that list here (the agent's own writing of it is
# web/media_agent/test_agent.py's): every job skips what it lists, and old Removed folders are emptied, nothing else.
def write_removed(agent_root, paths, days=()):
    rd = os.path.join(agent_root, '.nimrod-removed')
    os.makedirs(rd, exist_ok=True)
    with open(os.path.join(rd, 'removed-paths.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(''.join(p + '\n' for p in paths))
    for d in days:
        os.makedirs(os.path.join(rd, d, 'trip'), exist_ok=True)
        with open(os.path.join(rd, d, 'trip', 'x.jpg'), 'wb') as f:
            f.write(b'x')
    return rd


@unittest.skipUnless(BASH, 'no bash here (Git for Windows, or /bin/bash)')
class RemovedPicturesTest(unittest.TestCase):
    setUp_pull = PhotoPullTest.setUp
    setUp_copy = CopyJobTest.setUp
    tearDown = PhotoPullTest.tearDown
    _stub = staticmethod(PhotoPullTest._stub)
    run_pull = PhotoPullTest.run_pull
    rclone_calls = PhotoPullTest.rclone_calls
    pic = CopyJobTest.pic
    run_job = CopyJobTest.run_job
    in_fallback = CopyJobTest.in_fallback
    fallback_pictures = CopyJobTest.fallback_pictures

    def setUp(self):
        self.setUp_copy()

    def filters(self, name='filter-main.txt'):
        with open(os.path.join(self.state, name), encoding='utf-8') as f:
            return f.read().splitlines()

    def test_job1_leaves_every_removed_path_out_first_relative_to_its_target(self):
        # The agent serves <drive>/photos (above the Drive copy's target, photos/family_drive); one list in the target too.
        write_removed(os.path.join(self.drive, 'photos'), ['family_drive/2026/a.jpg', 'family_drive/IMG_1.HEIC.jpg',
                                                            'elsewhere/b.jpg', 'family_drive/odd [1]*.jpg'])
        os.makedirs(self.target, exist_ok=True)
        write_removed(self.target, ['c.jpg'])
        rc, out = self.run_pull('--now', FAKE_NEW=1)
        self.assertEqual(rc, 0, out)
        rules = self.filters()
        self.assertEqual(rules[:4], ['- /c.jpg', '- /2026/a.jpg', '- /IMG_1.HEIC.jpg', '- /odd \\[1\\]\\*.jpg'],
                         'the removed paths first, relative to the target, glob characters escaped; another folder\'s not')
        self.assertIn('- /.nimrod-removed/**', rules, 'a Removed folder inside the target is never copied over or deleted')
        self.assertIn('- /IMG_1.HEIC', self.filters('filter-heic.txt'), 'the removed iPhone picture\'s original is skipped too')
        self.assertIn('4 removed pictures kept out', out)
        main = self.rclone_calls('copy')[0]
        self.assertEqual(main[main.index('--filter-from') + 1], posix(os.path.join(self.state, 'filter-main.txt')))

    def test_mirroring_never_deletes_the_removed_folder_inside_the_target(self):
        os.makedirs(self.target, exist_ok=True)
        write_removed(self.target, ['a.jpg'])
        rc, out = self.run_pull('--now', NIMROD_PULL_MIRROR_DELETES=1)
        self.assertEqual(rc, 0, out)
        self.assertIn('- /.nimrod-removed/**', self.filters(), 'excluded, so `rclone sync` leaves it alone')
        self.assertEqual(self.filters()[0], '- /a.jpg')

    def test_a_removed_iphone_picture_is_not_converted_again(self):
        os.makedirs(self.target, exist_ok=True)
        write_removed(self.target, ['IMG_1.HEIC.jpg'])
        rc, out = self.run_pull('--now', FAKE_HEIC='IMG_1.HEIC')       # the stand-in still fetches the original
        self.assertEqual(rc, 0, out)
        self.assertFalse(os.path.exists(os.path.join(self.target, 'IMG_1.HEIC.jpg')), 'never made again')

    def test_without_a_list_nothing_changes(self):
        rc, out = self.run_pull('--now', FAKE_NEW=2)
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.filters()[0], '- /.nimrod-removed/**')
        self.assertNotIn('kept out', out)

    def test_a_local_copy_job_never_copies_a_removed_picture_back(self):
        self.pic('a.jpg', 1); self.pic('trip/b.jpg', 2); self.pic('c.jpg', 3)
        os.makedirs(self.fallback)
        write_removed(self.fallback, ['trip/b.jpg'])                  # removed from the fallback, still on the primary
        rc, out = self.run_job('--now')
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.fallback_pictures(), ['a.jpg', 'c.jpg'])
        self.assertIn('1 removed picture kept out', out)
        self.assertTrue(os.path.exists(os.path.join(self.fallback, '.nimrod-removed', 'removed-paths.txt')),
                        'the Removed folder in the target is left alone')

    def clock(self, y, m, d):
        return str(calendar.timegm((y, m, d, 12, 0, 0)))

    def test_old_removed_folders_are_emptied_and_nothing_else(self):
        root = os.path.join(self.drive, 'photos')                     # the agent's folder, above job 1's target
        rd = write_removed(root, ['x.jpg'], days=('2026-08-01', '2026-09-05-2', '2026-10-01'))
        os.makedirs(os.path.join(rd, 'family_drive', '2026-08-01'))   # job 1's own mirror backups: not this feature's
        os.makedirs(os.path.join(rd, 'notes'))
        bare = os.path.join(self.drive, 'other', '.nimrod-removed', '2026-01-01')   # no agent list beside it
        os.makedirs(bare)
        rc, out = self.run_pull('--now', NIMROD_PULL_TEST_CLOCK=self.clock(2026, 10, 10), TZ='UTC')
        self.assertEqual(rc, 0, out)
        left = sorted(os.listdir(rd))
        self.assertEqual(left, ['2026-10-01', 'family_drive', 'notes', 'removed-paths.txt'],
                         'older than 30 days emptied; the newer one, the mirror backups, other folders and the list kept')
        self.assertTrue(os.path.isdir(bare), 'a Removed folder the agent did not make is never emptied')
        self.assertIn('emptied 2 Removed folders older than 30 days', out)

    def test_emptying_can_be_off_or_set_and_dry_run_only_says(self):
        root = os.path.join(self.drive, 'photos')
        rd = write_removed(root, ['x.jpg'], days=('2026-08-01', '2026-10-01'))
        rc, out = self.run_pull('--dry-run', NIMROD_PULL_TEST_CLOCK=self.clock(2026, 10, 10), TZ='UTC')
        self.assertEqual(rc, 0, out)
        self.assertIn('would empty:', out)
        self.assertTrue(os.path.isdir(os.path.join(rd, '2026-08-01')), 'a dry run deletes nothing')
        rc, out = self.run_pull('--now', NIMROD_PULL_EMPTY_REMOVED_DAYS=0, NIMROD_PULL_TEST_CLOCK=self.clock(2026, 10, 10), TZ='UTC')
        self.assertEqual(rc, 0, out)
        self.assertTrue(os.path.isdir(os.path.join(rd, '2026-08-01')), '0: never emptied here')
        rc, out = self.run_pull('--now', NIMROD_PULL_EMPTY_REMOVED_DAYS=7, NIMROD_PULL_TEST_CLOCK=self.clock(2026, 10, 10), TZ='UTC')
        self.assertEqual(sorted(os.listdir(rd)), ['removed-paths.txt'], '7 days: both emptied')
        rc, out = self.run_pull('--now', NIMROD_PULL_EMPTY_REMOVED_DAYS='soon')
        self.assertEqual(rc, 2, out)
        self.assertIn('number of days', out)

    def test_a_local_jobs_source_and_target_removed_folders_are_emptied_too(self):
        self.pic('a.jpg', 1)
        os.makedirs(self.fallback)
        rd = write_removed(self.fallback, ['b.jpg'], days=('2026-08-01',))
        rc, out = self.run_job('--now', NIMROD_PULL_TEST_CLOCK=self.clock(2026, 10, 10), TZ='UTC')
        self.assertEqual(rc, 0, out)
        self.assertFalse(os.path.exists(os.path.join(rd, '2026-08-01')))


class FallbackInstallTest(unittest.TestCase):
    """The second agent's unit and the installer's step 9, read as text (nothing here installs anything)."""

    def read(self, name):
        with open(os.path.join(HERE, name), 'rb') as f:
            raw = f.read()
        self.assertNotIn(b'\r\n', raw, f'{name}: CRLF breaks it on the Pi')
        return raw.decode('utf-8')

    def test_the_fallback_agent_unit_takes_its_folder_and_port_from_its_settings(self):
        unit = self.read('nimrod-fallback-agent.service')
        self.assertIn('EnvironmentFile=%h/.config/nimrod/fallback-agent.env', unit)
        self.assertIn('ExecStart=/usr/bin/python3 %h/.local/bin/nimrod-media-agent.py', unit)
        self.assertNotIn('--port', unit, 'the port is a setting, not written into the unit')
        self.assertNotIn('NIMROD_MEDIA_DATA=', unit, 'history is the drive agent\'s; two would double it')
        self.assertIn('WantedBy=default.target', unit)

    def test_the_installer_adds_it_only_when_asked(self):
        sh = self.read('install-linux.sh')
        self.assertIn('if [ "${NIMROD_FALLBACK:-0}" = "1" ]; then', sh, 'off by default, like steps 7 and 8')
        self.assertIn('FALLBACK_PORT="${NIMROD_FALLBACK_PORT:-8771}"', sh)
        self.assertIn('FALLBACK_DIR="${NIMROD_FALLBACK_DIR:-$HOME/nimrod-fallback}"', sh)
        block = sh[sh.index('NIMROD_PULL_JOB_FALLBACK_FROM=$PRIMARY_DIR'):]
        self.assertIn('NIMROD_PULL_JOB_FALLBACK_ALLOW_SYSTEM_DISK=1', block)
        self.assertNotIn('\nNIMROD_PULL_JOBS=', block.split('EOF')[0], 'the copy job is added OFF')
        self.assertIn('NIMROD_PULL_JOBS=drive\n', sh, 'a new photo-pull.env runs the Drive pull alone')
        self.read('nimrod-photo-pull.service')

    @unittest.skipUnless(BASH, 'no bash here (Git for Windows, or /bin/bash)')
    def test_the_installer_run_in_a_pretend_home(self):
        """install-linux.sh itself, with HOME a temp folder and systemctl a stand-in: step 9 off by default; on, it
        installs the unit, the agent and its settings, and adds the copy job OFF; run again, it keeps both files."""
        tmp = tempfile.mkdtemp(prefix='fallback-install-')
        self.addCleanup(shutil.rmtree, tmp, True)
        home, stubs = os.path.join(tmp, 'home'), os.path.join(tmp, 'bin')
        os.makedirs(home); os.makedirs(stubs)
        calls = os.path.join(tmp, 'systemctl.txt')
        for name, body in (('systemctl', '#!/bin/bash\necho "$*" >> "$FAKE_SYSTEMCTL_LOG"\n'),
                           ('pkill', '#!/bin/bash\nexit 0\n'),
                           ('python3', '#!/bin/bash\necho https://nimrodecosystem.com\n')):
            PhotoPullTest._stub(os.path.join(stubs, name), body)

        def install(**flags):
            e = {k: v for k, v in os.environ.items() if not k.startswith('NIMROD_')}
            e.update({'HOME': posix(home), 'NIMROD_LOCK': '0', 'FAKE_SYSTEMCTL_LOG': posix(calls)})
            e.update({k: str(v) for k, v in flags.items()})
            # the stand-ins first, ahead of what Git bash puts on PATH itself
            cmd = f'export PATH="{posix(stubs)}:$PATH"; bash "{posix(os.path.join(HERE, "install-linux.sh"))}" https://nimrodecosystem.com/kiosk.html'
            p = subprocess.run([BASH, '-c', cmd], env=e, capture_output=True, text=True, timeout=60)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            return p.stdout + p.stderr

        units = os.path.join(home, '.config', 'systemd', 'user')
        pull_env = os.path.join(home, '.config', 'nimrod', 'photo-pull.env')
        fb_env = os.path.join(home, '.config', 'nimrod', 'fallback-agent.env')
        install(NIMROD_PHOTO_PULL=1)
        self.assertFalse(os.path.exists(os.path.join(units, 'nimrod-fallback-agent.service')), 'off unless asked')
        self.assertFalse(os.path.exists(fb_env))
        with open(pull_env, encoding='utf-8') as f:
            self.assertIn('\nNIMROD_PULL_JOBS=drive\n', f.read())

        out = install(NIMROD_PHOTO_PULL=1, NIMROD_FALLBACK=1, NIMROD_FALLBACK_PORT=8779)
        self.assertTrue(os.path.exists(os.path.join(units, 'nimrod-fallback-agent.service')))
        self.assertTrue(os.path.exists(os.path.join(home, '.local', 'bin', 'nimrod-media-agent.py')))
        self.assertTrue(os.path.isdir(os.path.join(home, 'nimrod-fallback')), 'the folder exists, so the agent can start')
        with open(fb_env, encoding='utf-8') as f:
            fb = f.read()
        self.assertIn('NIMROD_MEDIA_PORT=8779\n', fb, 'the port is a setting')
        self.assertIn('NIMROD_MEDIA_HOST=127.0.0.1\n', fb)
        self.assertIn('http://localhost:8779', out)
        with open(pull_env, encoding='utf-8') as f:
            env = f.read()
        self.assertEqual(env.count('NIMROD_PULL_JOB_FALLBACK_TO='), 1)
        self.assertIn('NIMROD_PULL_JOB_FALLBACK_ALLOW_SYSTEM_DISK=1\n', env)
        jobs = [ln for ln in env.splitlines() if ln.startswith('NIMROD_PULL_JOBS=')]
        self.assertEqual(jobs, ['NIMROD_PULL_JOBS=drive'], 'the copy job is added OFF')
        with open(calls, encoding='utf-8') as f:
            self.assertIn('--user enable nimrod-fallback-agent.service', f.read())

        with open(fb_env, 'a', encoding='utf-8', newline='\n') as f:
            f.write('# mine\n')
        out = install(NIMROD_PHOTO_PULL=1, NIMROD_FALLBACK=1)
        self.assertIn('kept existing', out)
        with open(fb_env, encoding='utf-8') as f:
            self.assertIn('# mine', f.read(), 'the person\'s file is kept')
        with open(pull_env, encoding='utf-8') as f:
            self.assertEqual(f.read().count('NIMROD_PULL_JOB_FALLBACK_TO='), 1, 'not added twice')


if __name__ == '__main__':
    unittest.main()
