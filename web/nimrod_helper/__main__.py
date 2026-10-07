"""python -m nimrod_helper <run | status | install | uninstall | register | unregister>

    run          the supervisor (what starts with Windows). Ctrl+C stops it.
    status       print what is running (from http://127.0.0.1:<statusPort>/status)
    install      copy the program to %LOCALAPPDATA%\\Programs\\Nimrod Helper, add it to the Apps list,
                 start it with Windows, start it now. From a built package folder: --payload <folder>.
                 From this checkout: --use-this-python (the Python running this command does the work).
    uninstall    stop it and remove everything install wrote (what the Apps list's Uninstall runs)
    register     start-with-Windows + Start menu + start now (a setup.exe calls this after copying files)
    unregister   stop it, and remove start-with-Windows, the Start menu shortcuts and the data folder
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

from . import settings as S

HERE = Path(__file__).resolve().parent          # .../nimrod_helper
APP_DIR = HERE.parent                           # the folder holding nimrod_helper, speech_service, media_agent


def say(lines, quiet=False):
    if quiet or sys.stdout is None:             # pythonw (the Apps list's Uninstall) has nowhere to print
        return
    for line in lines:
        print(line)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog='nimrod_helper', description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('command', choices=['run', 'status', 'install', 'uninstall', 'register', 'unregister'])
    ap.add_argument('--payload', default=None, help='install: a folder build_windows.py made (python\\ and app\\)')
    ap.add_argument('--use-this-python', action='store_true',
                    help='install: run the helper with the Python running this command (development)')
    ap.add_argument('--models-dir', default=None,
                    help='install: keep the speech model here instead of in the data folder '
                         '(an existing cache means nothing is downloaded; uninstall leaves it alone)')
    ap.add_argument('--no-start', action='store_true', help='install/register: do not start it now')
    ap.add_argument('--keep-data', action='store_true', help='uninstall/unregister: keep settings, logs and the model')
    ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args(argv)

    if a.command == 'run':
        from .supervisor import run
        return run(APP_DIR)

    if a.command == 'status':
        st, _ = S.load(S.settings_path())
        url = f'http://127.0.0.1:{int(st.get("statusPort") or 8790)}/status'
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                data = json.loads(r.read().decode())
        except OSError:
            print(f'The helper is not running here (nothing answered {url}).')
            return 1
        for p in data.get('parts', []):
            print(f'{p["label"]}: {p["state"]}{" - " + p["note"] if p.get("note") else ""}')
        return 0

    if sys.platform != 'win32':
        print('Installing is written for Windows so far. On a Mac or Linux, run `python3 -m nimrod_helper run` '
              'from a login item (Mac) or a systemd --user unit (Linux).', file=sys.stderr)
        return 2
    from . import install_windows as W
    reg = W.Registry()

    if a.command == 'install':
        if not a.payload and not a.use_this_python:
            print('install needs --payload <folder> (a built package) or --use-this-python (this checkout).',
                  file=sys.stderr)
            return 2
        lay = W.layout(python=Path(sys.executable) if a.use_this_python else None)
        over = {'speech': {'modelsDir': str(Path(a.models_dir).expanduser())}} if a.models_dir else None
        done = W.install(lay, reg, web_dir=None if a.payload else APP_DIR, payload=a.payload, settings_over=over,
                         start=not a.no_start)
        say(['Installed the Nimrod helper:', *[f'  - {d}' for d in done]], a.quiet)
        return 0

    # The other three act on the install this code is part of (its own folder), or the default place.
    home = APP_DIR.parent if (APP_DIR.parent / W.MARKER).exists() else None
    lay = W.layout(home=home, python=None if home and (home / 'python').exists() else Path(sys.executable))
    if a.command == 'register':
        done = W.register(lay, reg, start=not a.no_start)
    elif a.command == 'unregister':
        done = W.unregister(lay, reg, keep_data=a.keep_data)
    else:
        done = W.uninstall(lay, reg, keep_data=a.keep_data)
    say([f'{a.command}:', *[f'  - {d}' for d in done]], a.quiet)
    return 0


if __name__ == '__main__':
    sys.exit(main())
