#!/usr/bin/env python3
"""The helper package, tested with no download and no real registry: a dictionary stands in for the
registry, temporary folders for the program, data and Start menu folders, and the speech program runs
with its fake backend (no model). One section starts the REAL supervisor, which starts the REAL speech
program as a child process, on free ports, and stops it again.

Run, from web/:
    py -3.13 nimrod_helper/test_helper.py
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WEB))
from nimrod_helper import settings as S  # noqa: E402
from nimrod_helper import supervisor as SV  # noqa: E402
from nimrod_helper import install_windows as W  # noqa: E402
from nimrod_helper import build_windows as B  # noqa: E402

passed = 0
failed = 0


def check(name: str, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}   {detail}')


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


# ------------------------------------------------------------------------------- settings ----
def settings_tests(tmp: Path):
    st, problem = S.load(tmp / 'none.json')
    check('settings: no file -> the defaults, and no problem', st == S.DEFAULTS and problem == '')
    check('settings: speech is on by default, media is off until a folder is chosen',
          st['speech']['on'] is True and st['media']['on'] is False and st['media']['folder'] == '')
    check('settings: the speech port is the one the site looks at (speech_engines.js LOCAL_URL 8797)',
          st['speech']['port'] == 8797
          and "LOCAL_URL = 'ws://127.0.0.1:8797/speech'" in (WEB / 'client' / 'speech_engines.js').read_text(encoding='utf-8'))
    (tmp / 'broken.json').write_text('{not json', encoding='utf-8')
    st2, problem2 = S.load(tmp / 'broken.json')
    check('settings: a broken file -> still the defaults, and it says why', st2 == S.DEFAULTS and 'could not be read' in problem2)
    S.save(tmp / 's.json', {'media': {'on': True, 'folder': 'D:/Pics'}, 'extra': 1})
    st3, _ = S.load(tmp / 's.json')
    check('settings: a file lays over the defaults one level deep (media.port kept, extra kept)',
          st3['media'] == {**S.DEFAULTS['media'], 'on': True, 'folder': 'D:/Pics'} and st3['extra'] == 1
          and st3['speech'] == S.DEFAULTS['speech'])
    check('settings: the model lives in the data folder unless a place is named',
          S.models_dir(S.DEFAULTS, tmp) == tmp / 'models'
          and S.models_dir({'speech': {'modelsDir': str(tmp / 'cache')}}, tmp) == tmp / 'cache')
    check('settings: the speech program answers to no other name by default (allowHosts empty)',
          st['speech']['allowHosts'] == [])
    sd = tmp / 'sec'
    check('secret: no file -> no pass phrase', S.read_secret(sd) is None)
    S.write_secret('a pass phrase', sd)
    check('secret: kept in its own file in the data folder, NOT in settings.json',
          S.secret_path(sd) == sd / 'speech_secret.txt' and S.read_secret(sd) == 'a pass phrase'
          and not S.settings_path(sd).exists())
    S.secret_path(sd).write_bytes('﻿  spaced phrase \r\n'.encode('utf-8'))
    check('secret: an editor\'s line ending and BOM are dropped, its own spaces are kept',
          S.read_secret(sd) == '  spaced phrase ', repr(S.read_secret(sd)))
    S.secret_path(sd).write_text('\n', encoding='utf-8')
    check('secret: an empty file -> no pass phrase', S.read_secret(sd) is None)
    check('secret: cleared -> gone, and clearing again says there was none',
          S.clear_secret(sd) and not S.secret_path(sd).exists() and not S.clear_secret(sd))
    old = os.environ.get('NIMROD_HELPER_DATA')
    os.environ['NIMROD_HELPER_DATA'] = str(tmp / 'dd')
    check('settings: NIMROD_HELPER_DATA moves the data folder (the tests use it)', S.data_dir() == tmp / 'dd')
    if old is None:
        del os.environ['NIMROD_HELPER_DATA']
    else:
        os.environ['NIMROD_HELPER_DATA'] = old
    if sys.platform == 'win32':
        check('settings: on Windows, per user: the program under %LOCALAPPDATA%\\Programs, the data under %LOCALAPPDATA%',
              str(S.install_dir()).lower().endswith('\\programs\\nimrod helper') and str(S.data_dir()).lower().endswith('\\nimrod helper'),
              f'{S.install_dir()} {S.data_dir()}')


# ------------------------------------------------------------------------------- the plan ----
def plan_tests(tmp: Path):
    app, data = tmp / 'app', tmp / 'data'
    p = SV.plan(S.DEFAULTS, app, 'PY', data)
    check('plan: the defaults run the speech program alone', [x['name'] for x in p] == ['speech'])
    sp = p[0]
    check('plan: speech is `-m speech_service --port 8797`, from the app folder (whisper, small.en: its own defaults), '
          'allowing the sites the status page allows',
          sp['argv'] == ['PY', '-m', 'speech_service', '--port', '8797',
                         '--allow-origin', 'https://nimrodecosystem.com,https://nimrod.onrender.com',
                         '--voiceprints', str(data / 'voiceprints')]
          and sp['cwd'] == str(app), sp['argv'])
    check('*** plan: voiceprints (row 2.56) are kept in the helper\'s DATA folder - never inside app\\, which an '
          'update replaces wholesale ***', sp['argv'][sp['argv'].index('--voiceprints') + 1] == str(data / 'voiceprints')
          and str(app) not in sp['argv'][sp['argv'].index('--voiceprints') + 1], sp['argv'])
    check('*** the installer never copies voiceprints made beside the speech program into the app ***',
          W.skipped('voiceprints'))
    s1 = S.merged(S.DEFAULTS, {'platform': 'https://self.example/', 'alsoAllow': ['https://self.example', 'http://box:8000']})
    a1 = SV.plan(s1, app, 'PY', data)[0]['argv']
    check('plan: a self-hosted Nimrod is what the speech program allows (no repeats, no trailing slash)',
          a1[a1.index('--allow-origin') + 1] == 'https://self.example,http://box:8000', a1)
    check('plan: the model is kept in the data folder (HF_HOME), so uninstalling removes it',
          sp['env']['HF_HOME'] == str(data / 'models'))
    s2 = S.merged(S.DEFAULTS, {'speech': {'modelsDir': str(tmp / 'hf'), 'model': 'base.en'}})
    p2 = SV.plan(s2, app, 'PY', data)[0]
    check('plan: a named model place and another model are passed on',
          p2['env']['HF_HOME'] == str(tmp / 'hf') and p2['argv'][5:7] == ['--model', 'base.en'], p2['argv'])
    (tmp / 'models').mkdir(exist_ok=True)
    p3 = SV.plan(S.DEFAULTS, app, 'PY', data)[0]
    check('plan: a model that came in the package (beside app/) is used when no place is named',
          p3['env']['HF_HOME'] == str(tmp / 'models'))
    check('plan: no pass phrase and no other names -> no --allow-host, no --secret, no NIMROD_SPEECH_SECRET set',
          '--allow-host' not in sp['argv'] and '--secret' not in sp['argv'] and 'NIMROD_SPEECH_SECRET' not in sp['env'])
    s7 = S.merged(S.DEFAULTS, {'speech': {'allowHosts': [' desk.tail.ts.net ', '', 'other.example']}})
    p7 = SV.plan(s7, app, 'PY', data, secret='the phrase')[0]
    check('plan: allowHosts are passed as one --allow-host (blanks dropped)',
          p7['argv'][p7['argv'].index('--allow-host') + 1] == 'desk.tail.ts.net,other.example', p7['argv'])
    check('*** plan: the pass phrase goes in the speech program\'s environment, NEVER on its command line ***',
          p7['env'].get('NIMROD_SPEECH_SECRET') == 'the phrase' and 'the phrase' not in ' '.join(p7['argv'])
          and '--secret' not in p7['argv'], p7['argv'])
    check('plan: the backend and model are still whisper small.en (the speech program\'s defaults)',
          '--backend' not in p7['argv'] and '--model' not in p7['argv'])
    p4 = SV.plan(S.merged(S.DEFAULTS, {'speech': {'backend': 'fake'}}), app, 'PY', data)[0]
    check('plan: another backend is passed on, with no model', p4['argv'][5:7] == ['--backend', 'fake']
          and '--model' not in p4['argv'], p4['argv'])
    s5 = S.merged(S.DEFAULTS, {'speech': {'on': False}, 'media': {'on': True}})
    p5 = SV.plan(s5, app, 'PY', data)
    check('plan: media on with no folder is listed, not started, and says why',
          len(p5) == 1 and p5[0]['argv'] is None and 'no folder' in p5[0]['why'])
    s6 = S.merged(S.DEFAULTS, {'speech': {'on': False}, 'media': {'on': True, 'folder': 'D:/Pics', 'name': 'Den'}})
    a6 = SV.plan(s6, app, 'PY', data)[0]['argv']
    check('plan: media with a folder runs the agent on it, allowing the sites the status page allows, on 8770',
          a6 == ['PY', str(app / 'media_agent' / 'agent.py'), '--root', 'D:/Pics', '--port', '8770',
                 '--platform', 'https://nimrodecosystem.com',
                 '--origin', 'https://nimrodecosystem.com,https://nimrod.onrender.com', '--name', 'Den'], a6)
    check('plan: nothing on -> nothing runs', SV.plan(S.merged(S.DEFAULTS, {'speech': {'on': False}}), app, 'PY', data) == [])
    pyw = tmp / 'pythonw.exe'
    pyw.write_text('')
    (tmp / 'python.exe').write_text('')
    check('plan: the parts run under python.exe (logs, no window), even when the helper runs under pythonw',
          SV.child_python(str(pyw)) == str(tmp / 'python.exe'))


def origin_tests():
    st = S.DEFAULTS
    ok = SV.allowed_origin
    check('status page: the person\'s Nimrod may read it', ok('https://nimrodecosystem.com', st) and ok('https://nimrodecosystem.com/', st))
    check('status page: the older address too', ok('https://nimrod.onrender.com', st))
    check('status page: a page on this computer may (the dev server)', ok('http://127.0.0.1:8680', st) and ok('http://localhost:8000', st))
    check('*** status page: any other site may not ***',
          not ok('https://evil.example', st) and not ok('http://127.0.0.1.evil.example', st) and not ok('', st)
          and not ok('null', st) and not ok('https://nimrodecosystem.com.evil.example', st))
    # The speech program runs on its own too (a Pi has no helper), so it keeps its own copy of the default
    # sites and its own check. These fail if either drifts from the helper's.
    from speech_service import service as SP
    check('*** speech program: its default sites are the helper\'s platform + alsoAllow ***',
          tuple(SV.allowed_sites(st)) == SP.DEFAULT_SITES, (SV.allowed_sites(st), SP.DEFAULT_SITES))
    cases = ['https://nimrodecosystem.com', 'https://nimrodecosystem.com/', 'https://nimrod.onrender.com',
             'http://127.0.0.1:8680', 'http://localhost:8000', 'http://[::1]:9', 'https://evil.example', 'null',
             'http://127.0.0.1.evil.example', 'https://nimrodecosystem.com.evil.example', 'https://localhost:8000']
    differ = [o for o in cases if ok(o, st) != SP.origin_allowed(o, SP.DEFAULT_SITES)]
    check('*** speech program and status page agree on every site (a page with an Origin) ***', not differ, differ)
    check('status page: "on this computer" and the Host check are the speech program\'s own, not a copy',
          SV.LOCAL_ORIGIN is SP.LOCAL_ORIGIN and SV.host_refusal is SP.host_refusal)

# ---------------------------------------------------------------------- one part, restarted ----
class FakeProc:
    n = 0

    def __init__(self):
        FakeProc.n += 1
        self.pid = 1000 + FakeProc.n
        self.code = None
        self.killed = False

    def poll(self):
        return self.code

    def terminate(self):
        self.code = 0

    def wait(self, timeout=None):
        return self.code

    def kill(self):
        self.killed = True


def part_tests(tmp: Path):
    t = [0.0]
    procs = []
    up = [False]

    def popen(argv, **kw):
        procs.append((argv, kw))
        return FakeProc()

    spec = SV.plan(S.DEFAULTS, tmp / 'app', 'PY', tmp / 'pdata')[0]
    part = SV.Part(spec, tmp / 'logs', popen=popen, clock=lambda: t[0], probe=lambda port: up[0])
    part.start()
    check('part: started, and "starting" says the model is being fetched (none in the cache yet)',
          part.state == 'starting' and 'downloaded once' in part.note and len(procs) == 1, part.note)
    check('part: its output goes to its own log, with no window', procs[0][1]['stdout'] is not None
          and (tmp / 'logs' / 'speech.log').exists()
          and procs[0][1]['creationflags'] == (SV.CREATE_NO_WINDOW if sys.platform == 'win32' else 0))
    up[0] = True
    part.poll()
    check('part: the port answers -> running, note cleared', part.state == 'running' and part.note == '')
    up[0] = False           # it stops, and its port goes quiet with it
    part.proc.code = 1
    t[0] = 10
    part.poll()
    check('part: it stopped -> "starting again", after a 2 s wait', part.state == 'restarting' and part.next_at == 12)
    t[0] = 11
    part.poll()
    check('part: ...not before the wait', len(procs) == 1)
    t[0] = 12
    part.poll()
    check('part: ...then started again, counted', len(procs) == 2 and part.restarts == 1 and part.state == 'starting')
    waits = []
    for _ in range(5):
        part.proc.code = 1
        part.poll()
        waits.append(part.next_at - t[0])
        t[0] = part.next_at
        part.poll()
    check('part: stopping again and again waits longer each time, up to a minute', waits == [5, 15, 60, 60, 60], waits)
    t[0] += SV.STABLE_S + 1
    part.proc.code = 1
    part.poll()
    check('part: after staying up five minutes, a stop is a fresh one (2 s again)', part.next_at - t[0] == 2)
    t[0] = part.next_at
    part.poll()
    part.stop()
    check('part: stop ends it', part.state == 'stopped' and part.proc is None)
    md = SV.Part({'name': 'media', 'label': 'Media agent', 'argv': None, 'port': 8770, 'why': 'no folder chosen yet'},
                 tmp / 'logs', popen=popen)
    md.start()
    md.poll()
    check('part: media with no folder never starts, and says why', md.state == 'waiting' and len(procs) == 8
          and md.status()['note'] == 'no folder chosen yet', (md.state, len(procs)))

    # ONE COPY PER PORT: something already answers on the part's port (a copy started by hand).
    busy = [True]
    bprocs = []
    mspec = SV.plan(S.merged(S.DEFAULTS, {'speech': {'on': False}, 'media': {'on': True, 'folder': str(tmp)}}),
                    tmp / 'app', 'PY', tmp / 'pdata')[0]
    bp = SV.Part(mspec, tmp / 'logs', popen=lambda argv, **kw: (bprocs.append(argv), FakeProc())[1],
                 clock=lambda: t[0], probe=lambda port: busy[0])
    bp.start()
    check('*** part: its port already answers -> no second copy is started; it waits and says why ***',
          bprocs == [] and bp.proc is None and bp.state == 'waiting' and 'already in use' in bp.note
          and 'second copy' in bp.note, (bprocs, bp.state, bp.note))
    mlog = (tmp / 'logs' / 'media.log').read_text(encoding='utf-8')
    check('part: ...with one line in its log', mlog.count('not starting: port 8770 is already in use') == 1, mlog[-300:])
    t[0] += SV.PORT_BUSY_RECHECK_S
    bp.poll()
    check('part: still in use when it looks again -> still not started, and the log line is not repeated',
          bprocs == [] and bp.state == 'waiting' and bp.restarts == 0
          and (tmp / 'logs' / 'media.log').read_text(encoding='utf-8').count('not starting') == 1)
    busy[0] = False
    t[0] += SV.PORT_BUSY_RECHECK_S - 1
    bp.poll()
    check('part: ...not before the next look', bprocs == [])
    t[0] += 1
    bp.poll()
    check('*** part: the other copy is gone -> the helper starts its own ***',
          len(bprocs) == 1 and bp.state == 'starting' and bp.note == '', (bprocs, bp.state, bp.note))

    # A part that STOPPED, whose port is then taken by a copy started by hand: the helper's look finds the port
    # busy, and nothing restarted - so nothing is counted until the helper really starts its own again.
    rbusy = [False]
    rprocs = []
    rp = SV.Part(mspec, tmp / 'logs', popen=lambda argv, **kw: (rprocs.append(argv), FakeProc())[1],
                 clock=lambda: t[0], probe=lambda port: rbusy[0])
    rp.start()
    rp.proc.code = 1
    rp.poll()
    rbusy[0] = True
    t[0] = rp.next_at
    rp.poll()
    check('*** part: stopped, then its port is busy when it would start again -> no restart counted ***',
          rp.state == 'waiting' and rp.restarts == 0 and len(rprocs) == 1, (rp.state, rp.restarts, len(rprocs)))
    rbusy[0] = False
    t[0] = rp.next_at
    rp.poll()
    check('part: ...and counted once when the helper does start it again', rp.restarts == 1 and len(rprocs) == 2
          and rp.state == 'starting', (rp.restarts, len(rprocs), rp.state))

    def bad_popen(argv, **kw):
        raise OSError('no such program')
    b = SV.Part(spec, tmp / 'logs', popen=bad_popen, clock=lambda: t[0], probe=lambda port: False)
    b.start()
    check('part: a part that cannot even start says so and tries again later', b.state == 'failed' and 'could not start' in b.note
          and b.next_at > t[0])


def status_privacy_tests(tmp: Path):
    secret = 'D:/Family/Very private folder'
    s = S.merged(S.DEFAULTS, {'media': {'on': True, 'folder': secret}})
    data = tmp / 'sdata'
    S.save(S.settings_path(data), s)
    sup = SV.Supervisor(tmp / 'app', data, 'PY', popen=lambda argv, **kw: FakeProc(), probe=lambda p: False)
    sup.start()
    st = sup.status()
    check('*** status: never says the media folder, never a command line ***',
          secret not in json.dumps(st) and 'argv' not in json.dumps(st), json.dumps(st))
    check('status: both parts listed, with their ports', [p['name'] for p in st['parts']] == ['speech', 'media']
          and st['parts'][1]['port'] == 8770)
    pids = json.loads((data / 'helper.pids').read_text())
    check('status: the process ids are written for uninstall (the helper and each part)',
          pids.get('helper') == os.getpid() and isinstance(pids.get('speech'), int) and isinstance(pids.get('media'), int))
    html = SV.status_html(st)
    check('status page: plain words, how to stop it starting, how to remove it', 'Startup apps' in html and 'Uninstall' in html
          and secret not in html)
    sup.stop()


# --------------------------------------------- the pass phrase and the secure name (inbox BV) ----
PHRASE = 'test-phrase-not-real-7Qz'


def secret_tests(tmp: Path):
    import contextlib
    import io
    from nimrod_helper import __main__ as M
    data = tmp / 'sdata'
    S.save(S.settings_path(data), S.merged(S.DEFAULTS, {'speech': {'allowHosts': ['desk.tail.ts.net']}}))
    S.write_secret(PHRASE, data)
    popened = []
    sup = SV.Supervisor(tmp / 'app', data, 'PY', popen=lambda argv, **kw: (popened.append((argv, kw)), FakeProc())[1],
                        probe=lambda p: False)
    sup.start()
    argv, kw = popened[-1]
    check('*** supervisor: the speech program gets the pass phrase in its environment, not its command line ***',
          kw['env'].get('NIMROD_SPEECH_SECRET') == PHRASE and PHRASE not in ' '.join(argv)
          and argv[argv.index('--allow-host') + 1] == 'desk.tail.ts.net', argv)
    log = (data / 'logs' / 'speech.log').read_text(encoding='utf-8')
    check('*** the pass phrase is not in the part\'s log, /status, the status page or helper.pids ***',
          PHRASE not in log and '--allow-host desk.tail.ts.net' in log and PHRASE not in json.dumps(sup.status())
          and PHRASE not in SV.status_html(sup.status()) and PHRASE not in (data / 'helper.pids').read_text())
    S.write_secret('a new phrase', data)
    st = S.secret_path(data).stat()
    os.utime(S.secret_path(data), ns=(st.st_atime_ns, st.st_mtime_ns + 2_000_000_000))
    n = len(popened)
    sup.poll()
    check('supervisor: a changed pass phrase restarts the speech program with the new one',
          len(popened) == n + 1 and popened[-1][1]['env'].get('NIMROD_SPEECH_SECRET') == 'a new phrase')
    S.clear_secret(data)
    sup.poll()
    check('supervisor: a removed pass phrase restarts it without one (unless this computer\'s own environment has one)',
          len(popened) == n + 2 and popened[-1][1]['env'].get('NIMROD_SPEECH_SECRET') == os.environ.get('NIMROD_SPEECH_SECRET'))
    sup.stop()

    # The `secret` command: asked twice, never shown, never printed.
    answers = []
    check('secret command: two matching answers -> the phrase', M.ask_secret(lambda q: answers.pop(0) if answers else PHRASE)
          == (PHRASE, ''))
    seq = iter(['one', 'two'])
    v, why = M.ask_secret(lambda q: next(seq))
    check('secret command: two that differ -> nothing, and it says so', v is None and 'did not match' in why)
    v, why = M.ask_secret(lambda q: '')
    check('secret command: empty -> nothing', v is None and 'empty' in why)
    old_env, old_gp = os.environ.get('NIMROD_HELPER_DATA'), M.getpass.getpass
    os.environ['NIMROD_HELPER_DATA'] = str(tmp / 'cmd')
    try:
        M.getpass.getpass = lambda prompt='': PHRASE
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = M.main(['secret'])
        check('*** secret command: saved in the data folder, and the phrase is never printed ***',
              code == 0 and S.read_secret(tmp / 'cmd') == PHRASE and PHRASE not in out.getvalue() + err.getvalue()
              and 'speech_secret.txt' in out.getvalue(), out.getvalue())
        seq2 = iter(['x', 'y'])
        M.getpass.getpass = lambda prompt='': next(seq2)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = M.main(['secret'])
        check('secret command: a mismatch exits 2 and keeps the old phrase', code == 2 and S.read_secret(tmp / 'cmd') == PHRASE)
        with contextlib.redirect_stdout(io.StringIO()):
            code = M.main(['secret', '--clear'])
        check('secret command: --clear removes it', code == 0 and S.read_secret(tmp / 'cmd') is None)
    finally:
        M.getpass.getpass = old_gp
        if old_env is None:
            del os.environ['NIMROD_HELPER_DATA']
        else:
            os.environ['NIMROD_HELPER_DATA'] = old_env

    # `install --allow-host`: what it lays over the settings.
    import argparse
    ns = lambda **k: argparse.Namespace(**{'models_dir': None, 'allow_host': None, **k})  # noqa: E731
    check('install flags: nothing given -> the settings are left as they are', M.install_settings(ns()) is None)
    check('install flags: --allow-host (repeated or comma-separated, no repeats) -> speech.allowHosts',
          M.install_settings(ns(allow_host=['a.ts.net,b.ts.net', 'a.ts.net'])) == {'speech': {'allowHosts': ['a.ts.net', 'b.ts.net']}})
    check('install flags: --allow-host "" empties the list', M.install_settings(ns(allow_host=[''])) == {'speech': {'allowHosts': []}})
    over = M.install_settings(ns(allow_host=['desk.tail.ts.net'], models_dir=str(tmp / 'hf')))
    check('install flags: with --models-dir, both are laid over (and the pass phrase is not a flag at all)',
          over == {'speech': {'allowHosts': ['desk.tail.ts.net'], 'modelsDir': str(tmp / 'hf')}}, over)


def live_secret_tests(tmp: Path):
    """The REAL supervisor and speech program, with a pass phrase file and a secure name, as on a desktop that is
    another screen's second pass (DESKTOP_SECOND_PASS.md)."""
    data = tmp / 'livesec'
    sport, hport = free_port(), free_port()
    S.save(S.settings_path(data), S.merged(S.DEFAULTS, {'statusPort': hport, 'speech': {
        'backend': 'fake', 'port': sport, 'allowHosts': ['desk.tail.example.ts.net']}}))
    S.write_secret(PHRASE, data)
    env = {k: v for k, v in os.environ.items() if k != 'NIMROD_SPEECH_SECRET'}
    env['NIMROD_HELPER_DATA'] = str(data)
    proc = subprocess.Popen([sys.executable, '-m', 'nimrod_helper', 'run'], cwd=str(WEB), env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=0x00000200 if sys.platform == 'win32' else 0)

    def health(host):
        req = urllib.request.Request(f'http://127.0.0.1:{sport}/health', headers={'Host': host})
        try:
            with urllib.request.urlopen(req, timeout=2) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as err:
            return err.code, None
        except OSError:
            return None, None

    try:
        end = time.time() + 40
        code, body = None, None
        while time.time() < end:
            code, body = health(f'127.0.0.1:{sport}')
            if code == 200:
                break
            time.sleep(0.5)
        check('*** live: the helper\'s speech program says "secret": true in /health ***',
              code == 200 and body.get('secret') is True, (code, body))
        code, body = health('desk.tail.example.ts.net')
        check('*** live: it answers to the secure name the settings give it (what tailscale serve passes on) ***',
              code == 200 and body.get('ok') is True, (code, body))
        code, _ = health('evil.example')
        check('live: ...and still refuses any other name (403)', code == 403, code)
        from websockets.sync.client import connect

        def hello(secret):
            msg = {'type': 'hello', 'rate': 16000}
            if secret is not None:
                msg['secret'] = secret
            try:
                with connect(f'ws://127.0.0.1:{sport}/speech', open_timeout=5) as ws:
                    ws.send(json.dumps(msg))
                    got = json.loads(ws.recv(timeout=5))
                return got.get('kind'), got.get('error')
            except Exception as err:  # noqa: BLE001
                return 'exception', repr(err)
        check('*** live: a screen with no pass phrase is refused ***', hello(None) == ('error', 'secret'), hello(None))
        check('live: a screen with the wrong one is refused', hello('wrong') == ('error', 'secret'))
        check('*** live: a screen with the pass phrase from the helper\'s file gets its hello ***',
              hello(PHRASE)[0] == 'hello', hello(PHRASE))
        logs = ''.join(p.read_text(encoding='utf-8', errors='replace') for p in (data / 'logs').glob('*.log*'))
        with urllib.request.urlopen(f'http://127.0.0.1:{hport}/status', timeout=2) as r:
            status = r.read().decode()
        check('*** live: the pass phrase is in no log and not in /status ***', PHRASE not in logs and PHRASE not in status
              and 'also answers to desk.tail.example.ts.net' in logs, logs[-400:])
    finally:
        if sys.platform == 'win32':
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True)
        else:
            proc.kill()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            pass
        for pid in W.read_pids(data).values():
            if pid != os.getpid() and sys.platform == 'win32' and W.image_name(pid).startswith('python'):
                subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)


# ----------------------------------------------- the real supervisor, the real speech program ----
def live_tests(tmp: Path):
    data = tmp / 'live'
    sport, hport = free_port(), free_port()
    S.save(S.settings_path(data), S.merged(S.DEFAULTS, {'statusPort': hport,
                                                       'speech': {'backend': 'fake', 'port': sport}}))
    env = {**os.environ, 'NIMROD_HELPER_DATA': str(data)}
    proc = subprocess.Popen([sys.executable, '-m', 'nimrod_helper', 'run'], cwd=str(WEB), env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=0x00000200 if sys.platform == 'win32' else 0)
    try:
        st = None
        end = time.time() + 40
        while time.time() < end:
            try:
                req = urllib.request.Request(f'http://127.0.0.1:{hport}/status', headers={'Origin': 'https://nimrodecosystem.com'})
                with urllib.request.urlopen(req, timeout=2) as r:
                    st = json.loads(r.read().decode())
                    acao = r.headers.get('Access-Control-Allow-Origin')
                if st['parts'] and st['parts'][0]['state'] == 'running':
                    break
            except OSError:
                pass
            time.sleep(0.5)
        check('*** live: the supervisor started the speech program, and it answers on its port ***',
              bool(st) and st['parts'][0]['state'] == 'running' and SV.port_open(sport), json.dumps(st))
        check('live: /status answers the person\'s Nimrod with a CORS header', acao == 'https://nimrodecosystem.com')
        req = urllib.request.Request(f'http://127.0.0.1:{hport}/status', headers={'Origin': 'https://evil.example'})
        with urllib.request.urlopen(req, timeout=2) as r:
            check('live: ...and another site with none', r.headers.get('Access-Control-Allow-Origin') is None)
        req = urllib.request.Request(f'http://127.0.0.1:{hport}/status', method='OPTIONS',
                                     headers={'Origin': 'https://nimrodecosystem.com',
                                              'Access-Control-Request-Private-Network': 'true'})
        with urllib.request.urlopen(req, timeout=2) as r:
            check('live: the private-network preflight is answered', r.headers.get('Access-Control-Allow-Private-Network') == 'true')

        # DNS rebinding: a site whose name points at 127.0.0.1 sends ITS name as Host (and no Origin).
        def status_with_host(host, method='GET'):
            req = urllib.request.Request(f'http://127.0.0.1:{hport}/status', method=method, headers={'Host': host})
            try:
                with urllib.request.urlopen(req, timeout=2) as r:
                    return r.status, r.read()
            except urllib.error.HTTPError as err:
                return err.code, err.read()
        code, body = status_with_host('evil.example')
        check('*** live: /status with a Host that is not this computer -> 403, and nothing about the parts ***',
              code == 403 and b'parts' not in body, (code, body[:200]))
        code, _ = status_with_host('evil.example', 'OPTIONS')
        check('live: ...its preflight too', code == 403, code)
        code, _ = status_with_host(f'localhost:{hport}')
        check('live: a Host naming this computer goes on', code == 200, code)
        # The speech program speaks its protocol (a real WebSocket hello).
        try:
            from websockets.sync.client import connect
            with connect(f'ws://127.0.0.1:{sport}/speech', open_timeout=5) as ws:
                ws.send(json.dumps({'type': 'hello', 'rate': 16000}))
                hello = json.loads(ws.recv(timeout=5))
            check('live: the speech program says hello the way the site expects', hello.get('kind') == 'hello'
                  and hello.get('engine') == 'fake', hello)
        except Exception as err:  # noqa: BLE001
            check('live: the speech program says hello the way the site expects', False, repr(err))

        # Which pages may use it: the real program, as the helper started it (FastAPI/uvicorn where installed).
        def from_site(origin):
            from websockets.sync.client import connect
            from websockets.exceptions import InvalidStatus
            try:
                with connect(f'ws://127.0.0.1:{sport}/speech', origin=origin, open_timeout=5) as ws:
                    ws.send(json.dumps({'type': 'hello', 'rate': 16000}))
                    return json.loads(ws.recv(timeout=5)).get('kind')
            except InvalidStatus as err:
                return err.response.status_code
            except Exception as err:  # noqa: BLE001
                return repr(err)
        got = from_site('https://evil.example')
        check('*** live: a page from another site gets 403 from the speech program, and no socket ***', got == 403, got)
        got = from_site('https://nimrodecosystem.com')
        check('live: a page from the person\'s Nimrod gets its hello', got == 'hello', got)
        second = subprocess.Popen([sys.executable, '-m', 'nimrod_helper', 'run'], cwd=str(WEB), env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            code = second.wait(timeout=20)
        except subprocess.TimeoutExpired:
            code = None
            subprocess.run(['taskkill', '/PID', str(second.pid), '/T', '/F'], capture_output=True)
        check('*** live: a second copy finds the first running and leaves quietly (exit 0), starting nothing ***',
              code == 0, code)
        pids = json.loads((data / 'helper.pids').read_text())
        kid = pids.get('speech')
        # The speech program is killed from outside: the supervisor starts it again.
        if sys.platform == 'win32' and kid:
            subprocess.run(['taskkill', '/PID', str(kid), '/T', '/F'], capture_output=True)
            end = time.time() + 30
            again = None
            while time.time() < end:
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{hport}/status', timeout=2) as r:
                        again = json.loads(r.read().decode())['parts'][0]
                    if again['restarts'] >= 1 and again['state'] == 'running':
                        break
                except OSError:
                    pass
                time.sleep(0.5)
            check('*** live: the speech program was stopped from outside, and the supervisor started it again ***',
                  bool(again) and again['restarts'] >= 1 and again['state'] == 'running', again)
        # The supervisor ALONE is killed (End task, a crash): its part must end with it, not hold the port.
        if sys.platform == 'win32':
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/F'], capture_output=True)
        else:
            proc.kill()
        proc.wait(timeout=20)
        end = time.time() + 15
        while time.time() < end and SV.port_open(sport):
            time.sleep(0.5)
        check('*** live: the supervisor killed on its own -> the speech program ends with it (no orphan holding 8797) ***',
              not SV.port_open(sport) and not SV.port_open(hport))
    finally:
        if proc.poll() is None:
            proc.kill()
        # Nothing this test started may outlive it, whatever failed above.
        for pid in W.read_pids(data).values():
            if pid != os.getpid() and sys.platform == 'win32' and W.image_name(pid).startswith('python'):
                subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)


# ------------------------------------------------------------------ install and uninstall ----
def install_tests(tmp: Path):
    home, data, menu = tmp / 'home', tmp / 'data', tmp / 'menu'
    lay = W.layout(home=home, data=data, python=Path(sys.executable))
    reg = W.MemoryRegistry()
    spawned = []
    S.write_secret(PHRASE, data)
    done = W.install(lay, reg, web_dir=WEB, menu=menu, settings_over={'speech': {'modelsDir': str(tmp / 'hfcache')}},
                     spawn=lambda argv, cwd=None: spawned.append((argv, cwd)))
    files = {p.relative_to(lay.app).as_posix() for p in lay.app.rglob('*') if p.is_file()}
    check('install: the program is copied - the helper, the speech program, the media agent, the launcher',
          {'nimrod_helper/__main__.py', 'nimrod_helper/supervisor.py', 'speech_service/service.py',
           'speech_service/__main__.py', 'media_agent/agent.py', W.LAUNCHER} <= files, sorted(files)[:20])
    check('install: ...and not the tests, the build tools or caches',
          not any(f.split('/')[-1].startswith('test_') or '__pycache__' in f or 'build_windows' in f
                  or f.endswith('.iss') for f in files), [f for f in files if 'test_' in f or 'build' in f])
    cmd = reg.get(W.RUN_KEY, W.RUN_VALUE)
    check('install: starts with Windows: one Run value, the helper\'s launcher with `run`',
          cmd == f'"{lay.pythonw}" "{lay.launcher}" run', cmd)
    entry = reg.keys.get(W.UNINSTALL_KEY, {})
    check('install: in the Apps list, its Uninstall runs the helper\'s own uninstall',
          entry.get('DisplayName') == 'Nimrod helper' and entry.get('UninstallString') == f'"{lay.pythonw}" "{lay.launcher}" uninstall'
          and entry.get('NoModify') == 1 and isinstance(entry.get('EstimatedSize'), int), entry)
    check('install: Start menu: the site, and this computer\'s status page',
          (menu / 'Nimrod.url').read_text().strip().endswith('URL=https://nimrodecosystem.com/')
          and 'URL=http://127.0.0.1:8790/' in (menu / 'Nimrod helper status.url').read_text())
    st, _ = S.load(S.settings_path(data))
    check('install: the settings are written, with the named model place', st['speech']['modelsDir'] == str(tmp / 'hfcache'))
    check('install: it is started now, hidden, from its own folder',
          spawned == [([str(lay.pythonw), str(lay.launcher), 'run'], str(lay.app))], spawned)
    check('install: both folders carry the marker that lets uninstall delete them',
          (home / W.MARKER).exists() and (data / W.MARKER).exists())
    check('install: what it did is listed (and kept beside the program)', len(done) >= 5
          and json.loads((home / 'install_record.json').read_text())['did'] == done)
    # The copied launcher really runs the copied code, from anywhere.
    r = subprocess.run([sys.executable, str(lay.launcher), '--help'], capture_output=True, text=True, cwd=str(tmp), timeout=30)
    check('install: the copied launcher runs the copied helper', r.returncode == 0 and 'nimrod_helper' in r.stdout, r.stderr[-300:])

    # ---- uninstall ----
    (tmp / 'hfcache').mkdir(exist_ok=True)
    (tmp / 'hfcache' / 'keep.txt').write_text('a model cache somebody already had')
    (data / 'logs').mkdir(exist_ok=True)
    check('install: a pass phrase already set (re-installing over one) is kept, and is in no record install keeps',
          S.read_secret(data) == PHRASE and PHRASE not in (home / 'install_record.json').read_text()
          and PHRASE not in json.dumps(st))
    removed_home = []
    out = W.uninstall(lay, reg, menu=menu, stop=lambda d: ['helper (1)'],
                      remove_home=lambda l: (removed_home.append(l.home), 'removing home')[1])
    check('*** uninstall: start-with-Windows gone, the Apps entry gone, the Start menu folder gone ***',
          reg.get(W.RUN_KEY, W.RUN_VALUE) is None and W.UNINSTALL_KEY not in reg.keys and not menu.exists(), reg.keys)
    check('uninstall: the data folder (settings, logs, the pass phrase) is gone', not data.exists()
          and not S.secret_path(data).exists())
    check('*** uninstall: a model place OUTSIDE the data folder is left alone ***', (tmp / 'hfcache' / 'keep.txt').exists())
    check('uninstall: it stopped the helper first, and removes the program folder after', out[0].startswith('stopped')
          and removed_home == [home])
    # The real removal of the program folder: a separate process, once the uninstalling one has ended. A child
    # Python plays the uninstaller here (the first version of this used DETACHED_PROCESS and silently left the
    # folder behind - found by the 2026-10-07 install proof).
    if sys.platform == 'win32':
        gone_dir = tmp / 'home_to_remove'
        W.mark(gone_dir)
        (gone_dir / 'app').mkdir()
        (gone_dir / 'app' / 'x.py').write_text('x')
        code = ('import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); '
                'from nimrod_helper import install_windows as W; h = Path(sys.argv[2]); '
                'print(W.remove_home_later(W.Layout(home=h, app=h / "app", python=Path(sys.executable), '
                'pythonw=Path(sys.executable), data=h / "data")))')
        r = subprocess.run([sys.executable, '-c', code, str(WEB), str(gone_dir)], capture_output=True, text=True, timeout=30)
        end = time.time() + 20
        while time.time() < end and gone_dir.exists():
            time.sleep(0.5)
        check('*** uninstall: the program folder is really removed, after the uninstaller has exited ***',
              not gone_dir.exists() and 'removing' in r.stdout, (r.stdout, r.stderr[-300:]))

    # ---- the marker guard ----
    stranger = tmp / 'Documents'
    stranger.mkdir()
    (stranger / 'thesis.docx').write_text('years of work')
    lay2 = W.layout(home=tmp / 'home2', data=stranger, python=Path(sys.executable))
    out2 = W.unregister(lay2, W.MemoryRegistry(), menu=tmp / 'menu2', stop=lambda d: [])
    check('*** uninstall never deletes a folder that is not ours (no marker), and says it left it ***',
          (stranger / 'thesis.docx').exists() and any('not ours' in x for x in out2), out2)
    check('uninstall: removing the program folder is refused without the marker too',
          'no .nimrod-helper marker' in W.remove_home_later(lay2))


def stop_tests(tmp: Path):
    data = tmp / 'pids'
    data.mkdir()
    (data / 'helper.pids').write_text(json.dumps({'helper': 11, 'speech': 12, 'media': 13}))
    killed = []
    names = {11: 'pythonw.exe', 12: 'python.exe', 13: 'notepad.exe'}
    out = W.stop_running(data, image=lambda pid: names.get(pid, ''), kill=killed.append)
    check('*** stop: only ids that are still Python processes are stopped (a reused id is left alone) ***',
          killed == [11, 12] and out == ['helper (11)', 'speech (12)'], (killed, out))
    check('stop: no ids file, nothing stopped', W.stop_running(tmp / 'nothing', image=lambda p: 'python.exe', kill=killed.append) == [])


def build_tests(tmp: Path):
    shipped = 'python313.zip\n.\n\n# Uncomment to run site.main() automatically\n#import site\n'
    fixed = B.fixed_pth(shipped)
    check('build: the ._pth gains the libraries, the helper\'s code and `import site`, keeping python.org\'s lines',
          fixed.splitlines() == ['python313.zip', '.', '# Uncomment to run site.main() automatically',
                                 'Lib\\site-packages', '..\\app', 'import site'], fixed)
    check('build: ...and doing it twice changes nothing', B.fixed_pth(fixed) == fixed)
    cmd = B.pip_command(tmp / 'sp')
    check('build: libraries are Windows wheels for that exact Python, nothing compiled here',
          '--only-binary=:all:' in cmd and 'win_amd64' in cmd and '3.13' in cmd and str(B.REQUIREMENTS) in cmd)
    req = B.REQUIREMENTS.read_text()
    check('build: the requirements are pinned (the package is what was tested)',
          all('==' in ln for ln in req.splitlines() if ln.strip() and not ln.startswith('#')))
    check('build: the embeddable Python comes from python.org', B.embed_url('3.13.13')
          == 'https://www.python.org/ftp/python/3.13.13/python-3.13.13-embed-amd64.zip')
    iss = B.ISS.read_text()
    check('build: the setup.exe is per user (no administrator) and runs the helper\'s own register / unregister',
          'PrivilegesRequired=lowest' in iss and 'register --quiet' in iss and 'unregister --quiet' in iss
          and '{localappdata}\\Programs\\Nimrod Helper' in iss)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='nimrod_helper_test_', ignore_cleanup_errors=True) as d:
        tmp = Path(d)
        for sub in ('s', 'p', 'pt', 'sp', 'sec', 'b', 'st', 'i', 'l', 'ls'):
            (tmp / sub).mkdir()
        settings_tests(tmp / 's')
        plan_tests(tmp / 'p')
        origin_tests()
        part_tests(tmp / 'pt')
        status_privacy_tests(tmp / 'sp')
        secret_tests(tmp / 'sec')
        build_tests(tmp / 'b')
        stop_tests(tmp / 'st')
        install_tests(tmp / 'i')
        live_tests(tmp / 'l')
        live_secret_tests(tmp / 'ls')
    print(f'\n{passed} passed, {failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
