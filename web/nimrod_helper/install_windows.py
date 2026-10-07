"""Installing and removing the helper on Windows: per user, no administrator password.

WHAT AN INSTALL WRITES (and `uninstall` removes, every item):
  1. The program:   %LOCALAPPDATA%\\Programs\\Nimrod Helper\\  (python\\ its own Python, app\\ this code,
                    the speech program and the media agent)
  2. Its data:      %LOCALAPPDATA%\\Nimrod Helper\\  (settings.json, logs\\, models\\ the speech model)
  3. Start with Windows: one value, "Nimrod helper", under HKCU\\...\\CurrentVersion\\Run
  4. The Apps list: HKCU\\...\\CurrentVersion\\Uninstall\\NimrodHelper (Settings > Apps > Installed apps),
                    whose Uninstall button runs `uninstall`. A setup.exe built with Inno Setup writes its
                    own entry instead, and calls `register` / `unregister` for items 3 and 5.
  5. Start menu:    a "Nimrod" folder with "Nimrod" (the site) and "Nimrod helper status" (this computer's
                    status page) - plain internet shortcuts.

*** WHY THE RUN KEY, NOT A SCHEDULED TASK OR A SERVICE. *** Argued:
  * A Windows SERVICE needs an administrator to install. Out: the helper must install without one.
  * A SCHEDULED TASK (what the media agent's and the kiosk's own scripts use) can restart a task that
    fails, but a person never sees it: it lives in Task Scheduler, an administrator's tool.
  * The RUN KEY (chosen) is how ordinary per-user programs start with Windows (CurseForge, Roblox and
    Steam do it on this desktop, checked 2026-10-07). It shows in Task Manager > Startup apps and in
    Settings > Apps > Startup, each with an on/off switch: the standard place a person turns off
    something that starts with the computer. Restarting a stopped part is the supervisor's job, not the
    start-up entry's (supervisor.py).
  * The cost: a part is not running until somebody signs in. A screen nobody signs into needs Windows'
    automatic sign-in, the same separate, opt-in step the kiosk's README describes.

*** A FOLDER IS ONLY EVER DELETED IF IT CARRIES OUR MARKER (`.nimrod-helper`). *** An environment variable
pointing NIMROD_HELPER_DATA at somebody's Documents must not turn "uninstall" into "delete Documents".
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from . import VERSION
from . import settings as S

RUN_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
RUN_VALUE = 'Nimrod helper'
UNINSTALL_KEY = r'Software\Microsoft\Windows\CurrentVersion\Uninstall\NimrodHelper'
MENU_FOLDER = 'Nimrod'
MARKER = '.nimrod-helper'
LAUNCHER = 'start_helper.pyw'
DETACHED = 0x00000008 | 0x00000200 | 0x08000000   # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW

LAUNCHER_TEXT = '''"""Starts the Nimrod helper (written by nimrod_helper.install_windows). `run` unless told otherwise."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nimrod_helper.__main__ import main  # noqa: E402
sys.exit(main(sys.argv[1:] or ['run']))
'''


# ---------------------------------------------------------------------------------------------
# THE REGISTRY: the real one (HKEY_CURRENT_USER only - nothing here can touch the machine's keys), and a
# dictionary for the tests.
# ---------------------------------------------------------------------------------------------
class Registry:
    def __init__(self):
        import winreg  # noqa: WPS433 (Windows only)
        self.w = winreg

    def set(self, key: str, name: str, value):
        kind = self.w.REG_DWORD if isinstance(value, int) else self.w.REG_SZ
        with self.w.CreateKeyEx(self.w.HKEY_CURRENT_USER, key, 0, self.w.KEY_SET_VALUE) as k:
            self.w.SetValueEx(k, name, 0, kind, value)

    def get(self, key: str, name: str):
        try:
            with self.w.OpenKey(self.w.HKEY_CURRENT_USER, key) as k:
                return self.w.QueryValueEx(k, name)[0]
        except OSError:
            return None

    def delete_value(self, key: str, name: str) -> bool:
        try:
            with self.w.OpenKey(self.w.HKEY_CURRENT_USER, key, 0, self.w.KEY_SET_VALUE) as k:
                self.w.DeleteValue(k, name)
            return True
        except OSError:
            return False

    def delete_key(self, key: str) -> bool:
        try:
            self.w.DeleteKey(self.w.HKEY_CURRENT_USER, key)
            return True
        except OSError:
            return False


class MemoryRegistry:
    def __init__(self):
        self.keys: dict[str, dict] = {}

    def set(self, key, name, value):
        self.keys.setdefault(key, {})[name] = value

    def get(self, key, name):
        return self.keys.get(key, {}).get(name)

    def delete_value(self, key, name):
        return self.keys.get(key, {}).pop(name, None) is not None

    def delete_key(self, key):
        return self.keys.pop(key, None) is not None


# ---------------------------------------------------------------------------------------------
# WHERE IT GOES
# ---------------------------------------------------------------------------------------------
@dataclass
class Layout:
    home: Path          # the program folder
    app: Path           # home/app: nimrod_helper, speech_service, media_agent, the launcher
    python: Path        # python.exe the parts run under
    pythonw: Path       # pythonw.exe the helper itself runs under (no window)
    data: Path          # settings, logs, models

    @property
    def launcher(self) -> Path:
        return self.app / LAUNCHER

    @property
    def bundled(self) -> bool:
        """Its own Python, inside the program folder (a real install), or this computer's (development)."""
        try:
            self.python.relative_to(self.home)
            return True
        except ValueError:
            return False


def layout(home: Path | None = None, data: Path | None = None, python: Path | None = None) -> Layout:
    """`python`: an interpreter to use instead of the bundled one (`--use-this-python`, development)."""
    h = Path(home or S.install_dir())
    py = Path(python) if python else h / 'python' / 'python.exe'
    pyw = py.with_name('pythonw.exe') if py.with_name('pythonw.exe').exists() or not python else py
    return Layout(home=h, app=h / 'app', python=py, pythonw=pyw, data=Path(data or S.data_dir()))


def start_menu_dir() -> Path:
    v = os.environ.get('NIMROD_HELPER_MENU')
    if v:
        return Path(v)
    return Path(os.environ.get('APPDATA') or Path.home() / 'AppData' / 'Roaming') / 'Microsoft' / 'Windows' / \
        'Start Menu' / 'Programs' / MENU_FOLDER


def run_command(lay: Layout, verb: str = 'run') -> str:
    return f'"{lay.pythonw}" "{lay.launcher}" {verb}'


# ---------------------------------------------------------------------------------------------
# THE PROGRAM'S FILES
# ---------------------------------------------------------------------------------------------
# What the helper carries, from web/. Tests, build tools, a person's own voice model and the speech
# program's local "where is my Nimrod folder" note stay behind.
APP_PARTS = ('nimrod_helper', 'speech_service', 'media_agent/agent.py')
SKIP_NAMES = {'__pycache__', 'my_voice_model', 'nimrod_folder.txt', 'build', 'dist', 'windows',
              'build_windows.py', 'make_test_fixtures.py'}


def skipped(name: str) -> bool:
    return name in SKIP_NAMES or (name.startswith('test_') and name.endswith('.py'))


def app_files(web_dir: Path) -> list[tuple[Path, str]]:
    """(source file, path under app/) for everything the helper carries."""
    web = Path(web_dir)
    out = []
    for part in APP_PARTS:
        src = web / part
        if src.is_file():
            out.append((src, part))
            continue
        for root, dirs, files in os.walk(src):
            dirs[:] = sorted(d for d in dirs if not skipped(d))
            for f in sorted(files):
                if skipped(f):
                    continue
                p = Path(root) / f
                out.append((p, p.relative_to(web).as_posix()))
    return out


def copy_app(web_dir: Path, app_dir: Path) -> list[str]:
    app = Path(app_dir)
    if app.exists():
        shutil.rmtree(app)            # a new version replaces the old program; the data folder is untouched
    written = []
    for src, rel in app_files(web_dir):
        dst = app / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        written.append(rel)
    (app / LAUNCHER).write_text(LAUNCHER_TEXT, encoding='utf-8')
    written.append(LAUNCHER)
    return written


def mark(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / MARKER).write_text('Made by the Nimrod helper installer. Uninstalling removes this folder.\n',
                                 encoding='utf-8')


def ours(folder: Path) -> bool:
    return folder.is_dir() and (folder / MARKER).is_file()


def folder_kb(folder: Path) -> int:
    total = 0
    for root, _, files in os.walk(folder):
        for f in files:
            try:
                total += (Path(root) / f).stat().st_size
            except OSError:
                pass
    return total // 1024


# ---------------------------------------------------------------------------------------------
# REGISTER / UNREGISTER: start with Windows, the Start menu, and starting it now
# ---------------------------------------------------------------------------------------------
def write_url(path: Path, url: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'[InternetShortcut]\nURL={url}\n', encoding='utf-8')


def spawn_detached(argv: list[str], cwd: str | None = None):
    return subprocess.Popen(argv, cwd=cwd, creationflags=DETACHED, close_fds=True, stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def register(lay: Layout, reg, menu: Path | None = None, start: bool = True, spawn=spawn_detached) -> list[str]:
    """Start with Windows, the Start menu shortcuts, and (start=True) start it now. Returns what it did."""
    menu = Path(menu or start_menu_dir())
    done = []
    mark(lay.data)
    st, _ = S.load(S.settings_path(lay.data))
    if not S.settings_path(lay.data).exists():
        S.save(S.settings_path(lay.data), st)
        done.append(f'wrote {S.settings_path(lay.data)}')
    reg.set(RUN_KEY, RUN_VALUE, run_command(lay))
    done.append(f'HKCU\\{RUN_KEY} "{RUN_VALUE}" = {run_command(lay)}')
    platform = str(st.get('platform') or S.DEFAULTS['platform']).rstrip('/')
    write_url(menu / 'Nimrod.url', f'{platform}/')
    write_url(menu / 'Nimrod helper status.url', f'http://127.0.0.1:{int(st.get("statusPort") or 8790)}/')
    done.append(f'Start menu: {menu}\\Nimrod.url, {menu}\\Nimrod helper status.url')
    if start:
        spawn([str(lay.pythonw), str(lay.launcher), 'run'], cwd=str(lay.app))
        done.append('started it')
    return done


def read_pids(data: Path) -> dict:
    try:
        v = json.loads((Path(data) / 'helper.pids').read_text(encoding='utf-8'))
        return {k: int(p) for k, p in v.items() if isinstance(p, int) or str(p).isdigit()}
    except (OSError, ValueError):
        return {}


def image_name(pid: int) -> str:
    """The program a process id belongs to (lower case), '' if none. So a recycled id is never stopped."""
    try:
        out = subprocess.run(['tasklist', '/FI', f'PID eq {int(pid)}', '/FO', 'CSV', '/NH'], capture_output=True,
                             text=True, timeout=10, creationflags=0x08000000).stdout
    except (OSError, subprocess.SubprocessError):
        return ''
    line = out.strip().splitlines()[0] if out.strip() else ''
    return line.split('","')[0].strip('"').lower() if line.startswith('"') else ''


def stop_running(data: Path, image=image_name, kill=None) -> list[str]:
    """Stop the helper and its parts: the ids it wrote, and only if each is still a Python process."""
    kill = kill or (lambda pid: subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True,
                                               timeout=15, creationflags=0x08000000))
    stopped = []
    for name, pid in read_pids(data).items():
        if pid == os.getpid():
            continue
        if image(pid).startswith('python'):
            kill(pid)
            stopped.append(f'{name} ({pid})')
    return stopped


def remove_folder(folder: Path, wait: float = 10.0) -> bool:
    """Delete one of OUR folders (marker present), retrying while a stopping process still holds a file."""
    folder = Path(folder)
    if not ours(folder):
        return False
    end = time.monotonic() + wait
    while True:
        try:
            shutil.rmtree(folder)
            return True
        except OSError:
            if time.monotonic() >= end:
                return False
            time.sleep(0.5)


def unregister(lay: Layout, reg, menu: Path | None = None, keep_data: bool = False, stop=stop_running) -> list[str]:
    menu = Path(menu or start_menu_dir())
    done = []
    gone = stop(lay.data)
    if gone:
        done.append('stopped ' + ', '.join(gone))
    if reg.delete_value(RUN_KEY, RUN_VALUE):
        done.append(f'removed HKCU\\{RUN_KEY} "{RUN_VALUE}"')
    for name in ('Nimrod.url', 'Nimrod helper status.url'):
        try:
            (menu / name).unlink()
            done.append(f'removed {menu / name}')
        except OSError:
            pass
    try:
        menu.rmdir()                    # only if nothing else of anyone's is in it
    except OSError:
        pass
    if not keep_data:
        if remove_folder(lay.data):
            done.append(f'removed {lay.data} (settings, logs, the speech model if it was kept there)')
        elif lay.data.exists():
            done.append(f'left {lay.data}: it has no {MARKER} marker, so it is not ours to delete')
    return done


# ---------------------------------------------------------------------------------------------
# INSTALL / UNINSTALL: the whole thing, without a setup.exe (the payload folder, or a development checkout)
# ---------------------------------------------------------------------------------------------
def install(lay: Layout, reg, web_dir: Path | None = None, payload: Path | None = None, menu: Path | None = None,
            settings_over: dict | None = None, start: bool = True, spawn=spawn_detached) -> list[str]:
    """Copy the program (from a built `payload` folder: its python/ and app/; or from `web_dir`, using the
    Python in `lay`), record it in the Apps list, then `register`."""
    done = []
    mark(lay.home)
    if payload is not None:
        p = Path(payload)
        for part in ('python', 'app', 'models'):
            if part == 'models' and not (p / part).is_dir():
                continue                # the model is only in a package built --with-model
            dst = lay.home / part
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(p / part, dst)
        done.append(f'copied {p} -> {lay.home}')
    else:
        files = copy_app(Path(web_dir), lay.app)
        done.append(f'copied {len(files)} files -> {lay.app}')
    if settings_over:
        mark(lay.data)
        st, _ = S.load(S.settings_path(lay.data))
        S.save(S.settings_path(lay.data), S.merged(st, settings_over))
        done.append(f'wrote {S.settings_path(lay.data)}')
    size = folder_kb(lay.home)
    entry = {
        'DisplayName': 'Nimrod helper',
        'DisplayVersion': VERSION,
        'Publisher': 'Nimrod',
        'InstallLocation': str(lay.home),
        'UninstallString': run_command(lay, 'uninstall'),
        'QuietUninstallString': run_command(lay, 'uninstall --quiet'),
        'NoModify': 1,
        'NoRepair': 1,
        'EstimatedSize': size,
        'InstallDate': time.strftime('%Y%m%d'),
    }
    for k, v in entry.items():
        reg.set(UNINSTALL_KEY, k, v)
    done.append(f'HKCU\\{UNINSTALL_KEY} (the Apps list entry, {size} KB)')
    done += register(lay, reg, menu, start=start, spawn=spawn)
    try:
        (lay.home / 'install_record.json').write_text(json.dumps({'version': VERSION, 'at': time.time(),
                                                                  'did': done}, indent=2), encoding='utf-8')
    except OSError:
        pass
    return done


def uninstall(lay: Layout, reg, menu: Path | None = None, keep_data: bool = False, stop=stop_running,
              remove_home=None) -> list[str]:
    done = unregister(lay, reg, menu, keep_data=keep_data, stop=stop)
    if reg.delete_key(UNINSTALL_KEY):
        done.append(f'removed HKCU\\{UNINSTALL_KEY}')
    done.append((remove_home or remove_home_later)(lay))
    return done


def remove_home_later(lay: Layout) -> str:
    """The program folder holds the Python running this very uninstall (a real install), so it is deleted by
    a separate, hidden PowerShell that waits for this process to end first."""
    if not ours(lay.home):
        return f'left {lay.home}: it has no {MARKER} marker'
    home = str(lay.home).replace("'", "''")
    cmd = (f"Wait-Process -Id {os.getpid()} -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; "
           f"Remove-Item -LiteralPath '{home}' -Recurse -Force -ErrorAction SilentlyContinue")
    # NOT DETACHED_PROCESS: PowerShell started with no console at all exits before running anything (measured
    # 2026-10-07: the folder stayed; with CREATE_NO_WINDOW instead it gets a hidden console and the folder goes).
    subprocess.Popen(['powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd],
                     cwd=os.environ.get('TEMP') or None, creationflags=0x00000200 | 0x08000000, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return f'removing {lay.home} once this uninstaller has finished'
