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
    check('plan: speech is `-m speech_service --port 8797`, from the app folder (whisper, small.en: its own defaults)',
          sp['argv'] == ['PY', '-m', 'speech_service', '--port', '8797'] and sp['cwd'] == str(app), sp['argv'])
    check('plan: the model is kept in the data folder (HF_HOME), so uninstalling removes it',
          sp['env']['HF_HOME'] == str(data / 'models'))
    s2 = S.merged(S.DEFAULTS, {'speech': {'modelsDir': str(tmp / 'hf'), 'model': 'base.en'}})
    p2 = SV.plan(s2, app, 'PY', data)[0]
    check('plan: a named model place and another model are passed on',
          p2['env']['HF_HOME'] == str(tmp / 'hf') and p2['argv'][-2:] == ['--model', 'base.en'])
    (tmp / 'models').mkdir(exist_ok=True)
    p3 = SV.plan(S.DEFAULTS, app, 'PY', data)[0]
    check('plan: a model that came in the package (beside app/) is used when no place is named',
          p3['env']['HF_HOME'] == str(tmp / 'models'))
    p4 = SV.plan(S.merged(S.DEFAULTS, {'speech': {'backend': 'fake'}}), app, 'PY', data)[0]
    check('plan: another backend is passed on, with no model', p4['argv'][-2:] == ['--backend', 'fake'], p4['argv'])
    s5 = S.merged(S.DEFAULTS, {'speech': {'on': False}, 'media': {'on': True}})
    p5 = SV.plan(s5, app, 'PY', data)
    check('plan: media on with no folder is listed, not started, and says why',
          len(p5) == 1 and p5[0]['argv'] is None and 'no folder' in p5[0]['why'])
    s6 = S.merged(S.DEFAULTS, {'speech': {'on': False}, 'media': {'on': True, 'folder': 'D:/Pics', 'name': 'Den'}})
    a6 = SV.plan(s6, app, 'PY', data)[0]['argv']
    check('plan: media with a folder runs the agent on it, allowing the person\'s Nimrod, on 8770',
          a6 == ['PY', str(app / 'media_agent' / 'agent.py'), '--root', 'D:/Pics', '--port', '8770',
                 '--platform', 'https://nimrodecosystem.com', '--name', 'Den'], a6)
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

    def bad_popen(argv, **kw):
        raise OSError('no such program')
    b = SV.Part(spec, tmp / 'logs', popen=bad_popen, clock=lambda: t[0])
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
    removed_home = []
    out = W.uninstall(lay, reg, menu=menu, stop=lambda d: ['helper (1)'],
                      remove_home=lambda l: (removed_home.append(l.home), 'removing home')[1])
    check('*** uninstall: start-with-Windows gone, the Apps entry gone, the Start menu folder gone ***',
          reg.get(W.RUN_KEY, W.RUN_VALUE) is None and W.UNINSTALL_KEY not in reg.keys and not menu.exists(), reg.keys)
    check('uninstall: the data folder (settings, logs) is gone', not data.exists())
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
        for sub in ('s', 'p', 'pt', 'sp', 'b', 'st', 'i', 'l'):
            (tmp / sub).mkdir()
        settings_tests(tmp / 's')
        plan_tests(tmp / 'p')
        origin_tests()
        part_tests(tmp / 'pt')
        status_privacy_tests(tmp / 'sp')
        build_tests(tmp / 'b')
        stop_tests(tmp / 'st')
        install_tests(tmp / 'i')
        live_tests(tmp / 'l')
    print(f'\n{passed} passed, {failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
