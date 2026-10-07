"""The supervisor: `python -m nimrod_helper run`.

It is the one thing that starts with the computer. It starts each part the settings turn on, starts a
part again when it stops, and says what is running at http://127.0.0.1:<statusPort>/status.

*** WHY ONE SUPERVISOR AND NOT ONE START-UP ENTRY PER PART. *** Argued:
  * FOR one entry per part (the media agent's and the kiosk's installers each register their own task):
    each part is independent, and nothing extra runs.
  * AGAINST, and it wins: a person sees ONE "Nimrod helper" in Task Manager's Startup apps and turns it
    off in one place; a part added later needs no new start-up entry (each new entry is one more thing
    antivirus looks hard at, §nimrod-desktop-design Q4); and restart-on-stop is written once, here,
    instead of as a `while true` loop in every wrapper.

*** THE STATUS PAGE CARRIES NOTHING ANYBODY SAID OR SHOWED. *** Which parts run, on which ports, how
often they restarted, and whether the speech model is still being fetched. Never a word heard, never a
file name from the media folder (the folder's own path is not in it either).
"""
from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from speech_service.service import LOCAL_ORIGIN, host_refusal

from . import VERSION
from . import settings as S

# Wait before starting a stopped part again: quick at first (a part restarting), then slower, so a part
# that cannot start (a broken model, a port somebody else holds) costs one try a minute, not a busy loop.
BACKOFF_S = (2, 5, 15, 60)
# Up this long, and the next stop counts as a fresh one (the waits start again from the first).
STABLE_S = 300
# A part whose port something else already answers on is looked at again this often. 15 s: the look is one
# connect to this computer (under a millisecond), and a hand-started copy that is closed is replaced within
# 15 s instead of a minute.
PORT_BUSY_RECHECK_S = 15
# A part's log is moved aside past this size, so a part that fails every minute cannot fill the disk.
LOG_MAX_BYTES = 2 * 1024 * 1024
# The model faster-whisper downloads for `small.en`, as the Hugging Face cache names its folder. Used only
# to say "getting the speech model ready" while it downloads.
MODEL_REPOS = {'small.en': 'models--Systran--faster-whisper-small.en'}

# Which pages count as "on this computer" (LOCAL_ORIGIN) and the Host check (host_refusal) are the speech
# program's own (speech_service/service.py, "WHICH WEB PAGES"), imported rather than copied: the helper always
# ships beside it (install_windows.py APP_PARTS), and one copy cannot drift from the other.
CREATE_NO_WINDOW = 0x08000000


def port_open(port: int, host: str = '127.0.0.1', timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def child_python(python: str | None = None) -> str:
    """The interpreter the parts run under: the console one beside pythonw (a part's output goes to its log,
    and CREATE_NO_WINDOW keeps any window from showing)."""
    p = Path(python or sys.executable)
    if p.name.lower() == 'pythonw.exe':
        alt = p.with_name('python.exe')
        if alt.exists():
            return str(alt)
    return str(p)


def plan(settings: dict, app_dir, python: str, data: Path, models: Path | None = None) -> list[dict]:
    """What to run, from the settings. Pure: a list of {name, label, argv, cwd, env, port, why}. A part that is
    on but cannot run yet (media with no folder) is listed with argv None and `why`."""
    app = Path(app_dir)
    out = []
    sp = settings.get('speech') or {}
    if sp.get('on'):
        port = int(sp.get('port') or 8797)
        argv = [python, '-m', 'speech_service', '--port', str(port)]
        backend = str(sp.get('backend') or 'whisper')
        if backend != 'whisper':
            argv += ['--backend', backend]
        model = str(sp.get('model') or 'small.en') if backend == 'whisper' else ''
        if model and model != 'small.en':
            argv += ['--model', model]
        # The same sites the status page allows (allowed_origin): the speech program refuses pages from any
        # other site with 403. Passed every time, so these settings are the one list, not the program's own.
        argv += ['--allow-origin', ','.join(allowed_sites(settings))]
        # VOICEPRINTS (row 2.56) in the helper's own data folder: on this computer, never synced, kept when the
        # program is updated (the installer replaces app\ wholesale) and removed with it (speech_service/speakers.py
        # argues the place). Passed every time, so the speech program never falls back to a folder inside app\.
        argv += ['--voiceprints', str(Path(data) / 'voiceprints')]
        # A model that came IN the package (build_windows.py --with-model) sits beside app/; used unless the
        # settings name another place.
        bundled = app.parent / 'models'
        if models:
            mdir = Path(models)
        elif not str(sp.get('modelsDir') or '').strip() and bundled.is_dir():
            mdir = bundled
        else:
            mdir = S.models_dir(settings, data)
        out.append({'name': 'speech', 'label': 'Speech program', 'argv': argv, 'cwd': str(app), 'port': port,
                    'env': {'HF_HOME': str(mdir), 'PYTHONPATH': str(app), 'PYTHONUNBUFFERED': '1'},
                    'model': model, 'models': str(mdir), 'why': ''})
    md = settings.get('media') or {}
    if md.get('on'):
        port = int(md.get('port') or 8770)
        folder = str(md.get('folder') or '').strip()
        if not folder:
            out.append({'name': 'media', 'label': 'Media agent', 'argv': None, 'cwd': str(app), 'port': port,
                        'env': {}, 'why': 'no folder chosen yet'})
        else:
            # --origin: the same sites the status page and the speech program allow, so all three agree on what
            # "the person's Nimrod" is (the agent alone would allow only --platform).
            argv = [python, str(app / 'media_agent' / 'agent.py'), '--root', folder, '--port', str(port),
                    '--platform', str(settings.get('platform') or S.DEFAULTS['platform']),
                    '--origin', ','.join(allowed_sites(settings)),
                    '--name', str(md.get('name') or S.DEFAULTS['media']['name'])]
            out.append({'name': 'media', 'label': 'Media agent', 'argv': argv, 'cwd': str(app), 'port': port,
                        'env': {'PYTHONUNBUFFERED': '1'}, 'why': ''})
    return out


def allowed_sites(settings: dict) -> list[str]:
    """The person's Nimrod and the other addresses it is served at, from the settings, in order, no repeats."""
    out = []
    for a in [settings.get('platform') or ''] + list(settings.get('alsoAllow') or []):
        a = str(a).strip().rstrip('/')
        if a and a not in out:
            out.append(a)
    return out


def allowed_origin(origin: str, settings: dict) -> bool:
    """May a page from `origin` read /status? The person's Nimrod, the other addresses it is served at, and
    pages on this computer itself. Anything else gets no CORS header (the browser then hides the answer)."""
    o = str(origin or '').rstrip('/')
    if not o:
        return False
    if LOCAL_ORIGIN.match(o):
        return True
    return o in set(allowed_sites(settings))


def rotate(log: Path) -> None:
    try:
        if log.exists() and log.stat().st_size > LOG_MAX_BYTES:
            old = log.with_suffix(log.suffix + '.1')
            if old.exists():
                old.unlink()
            log.rename(old)
    except OSError:
        pass


class Part:
    """One running part: started, watched, started again after a wait when it stops."""

    def __init__(self, spec: dict, logs: Path, popen=subprocess.Popen, clock=time.monotonic, probe=port_open):
        self.spec = spec
        self.name = spec['name']
        self.logs = Path(logs)
        self.popen = popen
        self.clock = clock
        self.probe = probe
        self.proc = None
        self.state = 'waiting' if spec.get('argv') is None else 'starting'
        self.restarts = 0
        self.again = False      # the next real start is a restart (counted in start(), when it starts)
        self.fails = 0          # stops in a row, each sooner than STABLE_S after its start
        self.started_at = None
        self.next_at = 0.0
        self.last_exit = None
        self.note = spec.get('why') or ''

    def start(self):
        if self.spec.get('argv') is None:
            return
        log = self.logs / f'{self.name}.log'
        self.logs.mkdir(parents=True, exist_ok=True)
        rotate(log)
        # ONE COPY PER PORT. Something already answers on this part's port (a copy started by hand, or one
        # left running by an earlier helper): starting another would only fight it for the port (on Windows
        # both can end up listening at once). So the helper leaves it alone, says so, and looks again shortly;
        # when the port comes free, it starts its own.
        port = self.spec.get('port')
        if port and self.probe(port):
            if self.note != self._busy_note(port):
                self._log_line(log, f'not starting: port {port} is already in use (another copy is probably '
                                    'running); checking again shortly')
            self.proc = None
            self.state = 'waiting'
            self.note = self._busy_note(port)
            self.next_at = self.clock() + PORT_BUSY_RECHECK_S
            return
        env = {**os.environ, **(self.spec.get('env') or {})}
        flags = CREATE_NO_WINDOW if sys.platform == 'win32' else 0
        f = open(log, 'ab')
        try:
            f.write(f'\n--- {time.strftime("%Y-%m-%d %H:%M:%S")} starting: {" ".join(self.spec["argv"])}\n'.encode())
            f.flush()
            self.proc = self.popen(self.spec['argv'], cwd=self.spec.get('cwd'), env=env, stdout=f,
                                   stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags)
        except OSError as err:
            self.proc = None
            self.state = 'failed'
            self.note = f'could not start: {err}'
            self._schedule()
            return
        finally:
            f.close()
        self.started_at = self.clock()
        if self.again:
            self.restarts += 1
            self.again = False
        self.state = 'starting'
        self.note = self._starting_note()

    @staticmethod
    def _busy_note(port) -> str:
        return (f'port {port} is already in use on this computer, so the helper is not starting a second copy '
                '(one may have been started by hand)')

    @staticmethod
    def _log_line(log: Path, text: str) -> None:
        try:
            with open(log, 'a', encoding='utf-8') as f:
                f.write(f'\n--- {time.strftime("%Y-%m-%d %H:%M:%S")} {text}\n')
        except OSError:
            pass

    def _starting_note(self) -> str:
        if self.name == 'speech':
            repo = MODEL_REPOS.get(self.spec.get('model') or '')
            models = Path(self.spec.get('models') or '')
            if repo and not (models / 'hub' / repo).exists():
                return 'getting the speech model ready (about 500 MB, downloaded once)'
            return 'loading the speech model'
        return ''

    def _schedule(self):
        wait = BACKOFF_S[min(self.fails, len(BACKOFF_S) - 1)]
        self.fails += 1
        self.next_at = self.clock() + wait

    def poll(self):
        """Called about once a second. Notices a stop, waits, starts again; notices the port answering."""
        if self.spec.get('argv') is None:
            return
        now = self.clock()
        if self.proc is None:
            if now >= self.next_at:
                # A start after a stop (or a failed start) is a restart, COUNTED ONLY WHEN start() actually
                # starts it: when it finds the port busy instead, nothing restarted (found 2026-10-07).
                if self.state in ('restarting', 'failed'):
                    self.again = True
                self.start()
            return
        code = self.proc.poll()
        if code is not None:
            up = now - (self.started_at or now)
            if up >= STABLE_S:
                self.fails = 0
            self.last_exit = code
            self.proc = None
            self.state = 'restarting'
            self.note = f'stopped (exit {code}); starting again shortly'
            self._schedule()
            return
        if self.probe(self.spec['port']):
            if self.state != 'running':
                self.state = 'running'
                self.note = ''
        elif self.state == 'running':
            self.state = 'starting'

    def stop(self):
        p, self.proc = self.proc, None
        if p is None:
            return
        try:
            p.terminate()
            p.wait(timeout=5)
        except Exception:  # noqa: BLE001 - already gone, or will not go: kill it
            try:
                p.kill()
            except Exception:  # noqa: BLE001
                pass
        self.state = 'stopped'

    def status(self) -> dict:
        return {'name': self.name, 'label': self.spec.get('label') or self.name, 'state': self.state,
                'port': self.spec.get('port'), 'restarts': self.restarts, 'note': self.note,
                'pid': self.proc.pid if self.proc is not None else None}


class Supervisor:
    def __init__(self, app_dir, data: Path | None = None, python: str | None = None, popen=subprocess.Popen,
                 clock=time.monotonic, probe=port_open):
        self.app = Path(app_dir)
        self.data = Path(data or S.data_dir())
        self.python = child_python(python)
        self.popen, self.clock, self.probe = popen, clock, probe
        self.settings_file = S.settings_path(self.data)
        self.settings, self.problem = S.load(self.settings_file)
        self._mtime = self._stamp()
        self.parts: list[Part] = []
        self.lock = threading.Lock()
        self.started = time.time()

    def _stamp(self):
        try:
            return self.settings_file.stat().st_mtime
        except OSError:
            return None

    def start(self):
        with self.lock:
            self.parts = [Part(s, self.data / 'logs', self.popen, self.clock, self.probe)
                          for s in plan(self.settings, self.app, self.python, self.data)]
            for p in self.parts:
                p.start()
        self.write_pids()

    def stop(self):
        with self.lock:
            for p in self.parts:
                p.stop()
        self.write_pids()

    def poll(self):
        # The settings changed (somebody chose a media folder): stop everything and start what they now say.
        stamp = self._stamp()
        if stamp != self._mtime:
            self._mtime = stamp
            self.settings, self.problem = S.load(self.settings_file)
            self.stop()
            self.start()
            return
        with self.lock:
            before = [p.proc.pid if p.proc else None for p in self.parts]
            for p in self.parts:
                p.poll()
            after = [p.proc.pid if p.proc else None for p in self.parts]
        if before != after:
            self.write_pids()

    def write_pids(self):
        """helper.pids: this process and each part's, so `uninstall` can stop exactly these and nothing else."""
        try:
            self.data.mkdir(parents=True, exist_ok=True)
            pids = {'helper': os.getpid(), **{p.name: p.proc.pid for p in self.parts if p.proc is not None}}
            (self.data / 'helper.pids').write_text(json.dumps(pids), encoding='utf-8')
        except OSError:
            pass

    def status(self) -> dict:
        with self.lock:
            parts = [p.status() for p in self.parts]
        return {'ok': True, 'helper': 'nimrod', 'version': VERSION, 'since': int(self.started),
                'settingsProblem': self.problem, 'parts': parts}


# ---------------------------------------------------------------------------------------------
# THE STATUS PAGE: GET /status (JSON) and GET / (the same, as words). Loopback only.
# ---------------------------------------------------------------------------------------------
STATE_WORDS = {'running': 'running', 'starting': 'starting', 'restarting': 'starting again',
               'failed': 'could not start', 'waiting': 'waiting', 'stopped': 'stopped'}


def status_html(st: dict) -> str:
    esc = lambda s: str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')  # noqa: E731
    rows = ''.join(f'<li><b>{esc(p["label"])}</b>: {esc(STATE_WORDS.get(p["state"], p["state"]))}'
                   f'{" (" + esc(p["note"]) + ")" if p.get("note") else ""}</li>' for p in st['parts'])
    return ('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Nimrod helper</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 16px">'
            f'<h1>Nimrod helper</h1><p>Running on this computer (version {esc(st["version"])}).</p>'
            f'<ul>{rows or "<li>Nothing is turned on.</li>"}</ul>'
            '<p>It answers only on this computer. To stop it starting with Windows: Task Manager, Startup apps. '
            'To remove it: Settings, Apps, Installed apps, Nimrod helper, Uninstall.</p></body>')


def make_handler(sup: Supervisor):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'nimrod-helper'

        def log_message(self, *a):  # quiet: the status page is polled
            pass

        def _cors(self):
            origin = self.headers.get('Origin') or ''
            if allowed_origin(origin, sup.settings):
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
                # A public site asking a loopback address (Chrome's Private Network Access preflight).
                if self.headers.get('Access-Control-Request-Private-Network') == 'true':
                    self.send_header('Access-Control-Allow-Private-Network', 'true')

        def _refused(self) -> bool:
            # DNS REBINDING (found 2026-10-07). A site can point its own name at 127.0.0.1; its page is then
            # "same-site" with this server, sends no Origin, and could read /status. The server listens only on
            # this computer, so a Host naming anything else is refused - the speech program's check, shared.
            why = host_refusal(self.headers.get('Host'))
            if not why:
                return False
            body = json.dumps({'ok': False, 'error': why}).encode()
            self.send_response(403)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return True

        def do_OPTIONS(self):  # noqa: N802
            if self._refused():
                return
            self.send_response(204)
            self._cors()
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Max-Age', '600')
            self.end_headers()

        def do_GET(self):  # noqa: N802
            if self._refused():
                return
            path = self.path.split('?')[0]
            if path == '/status':
                body, kind = json.dumps(sup.status()).encode(), 'application/json'
            elif path == '/':
                body, kind = status_html(sup.status()).encode(), 'text/html; charset=utf-8'
            else:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', kind)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


class ExclusiveServer(ThreadingHTTPServer):
    """The status server, bound so a second copy CANNOT bind the same port. Python's HTTPServer sets
    SO_REUSEADDR, which on Windows lets a second program bind a port another is already listening on (found by
    test_helper.py 2026-10-07: two supervisors both started). Windows' own answer is SO_EXCLUSIVEADDRUSE."""
    allow_reuse_address = False

    def server_bind(self):
        if sys.platform == 'win32' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def kill_with_me():
    """Windows: put this process in a job that ends every part when the supervisor ends, however it ends
    (Task Manager's End task, a crash). Without it a killed supervisor leaves its parts running, holding their
    ports, and the next start-up's parts cannot bind them (seen in testing, 2026-10-07). Returns the job handle
    (kept for the life of the process), or None where it is not available."""
    if sys.platform != 'win32':
        return None
    try:
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)

        class BASIC(ctypes.Structure):
            _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                        ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                        ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                        ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD),
                        ('SchedulingClass', wintypes.DWORD)]

        class IO(ctypes.Structure):
            _fields_ = [(n, ctypes.c_uint64) for n in ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
                                                       'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]

        class EXTENDED(ctypes.Structure):
            _fields_ = [('BasicLimitInformation', BASIC), ('IoInfo', IO), ('ProcessMemoryLimit', ctypes.c_size_t),
                        ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t),
                        ('PeakJobMemoryUsed', ctypes.c_size_t)]

        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        job = k32.CreateJobObjectW(None, None)
        if not job:
            return None
        info = EXTENDED()
        info.BasicLimitInformation.LimitFlags = 0x2000          # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info)):
            return None                                         # 9 = JobObjectExtendedLimitInformation
        if not k32.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(k32.GetCurrentProcess())):
            return None
        return job                                              # children started from now on are in it too
    except Exception:  # noqa: BLE001 - an older Windows, or already in a job that forbids it: run without
        return None


def log_line(data: Path, text: str) -> None:
    try:
        (data / 'logs').mkdir(parents=True, exist_ok=True)
        with open(data / 'logs' / 'helper.log', 'a', encoding='utf-8') as f:
            f.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")} {text}\n')
    except OSError:
        pass


def run(app_dir, data: Path | None = None, python: str | None = None) -> int:
    sup = Supervisor(app_dir, data, python)
    port = int(sup.settings.get('statusPort') or S.DEFAULTS['statusPort'])
    # ONE AT A TIME: the status port is the lock. A second copy (signed in twice, or started by hand while
    # the start-up one runs) finds it taken and leaves quietly instead of fighting over the parts' ports.
    try:
        httpd = ExclusiveServer(('127.0.0.1', port), make_handler(sup))
    except OSError as err:
        log_line(sup.data, f'not starting: 127.0.0.1:{port} is taken ({err}); another helper is probably running')
        return 0
    job = kill_with_me()  # noqa: F841 - held for the life of the process; closing it is what ends the parts
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    log_line(sup.data, f'started {VERSION}; status on http://127.0.0.1:{port}/'
             + (f'; {sup.problem}' if sup.problem else '') + ('' if job or sys.platform != 'win32'
                                                              else '; (parts will not end with it: no job object)'))
    stopping = threading.Event()

    def on_signal(*_):
        stopping.set()

    for sig in (signal.SIGINT, signal.SIGTERM, getattr(signal, 'SIGBREAK', None)):
        if sig is not None:
            try:
                signal.signal(sig, on_signal)
            except (ValueError, OSError):
                pass
    sup.start()
    try:
        while not stopping.wait(1.0):
            sup.poll()
    finally:
        sup.stop()
        httpd.shutdown()
        log_line(sup.data, 'stopped')
        try:
            (sup.data / 'helper.pids').unlink()
        except OSError:
            pass
    return 0
