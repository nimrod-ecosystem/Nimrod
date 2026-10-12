"""python -m nimrod_helper <run | status | install | uninstall | register | unregister | secret>

    run          the supervisor (what starts with Windows). Ctrl+C stops it.
    status       print what is running (from http://127.0.0.1:<statusPort>/status)
    install      copy the program to %LOCALAPPDATA%\\Programs\\Nimrod Helper, add it to the Apps list,
                 start it with Windows, start it now. From a built package folder: --payload <folder>.
                 From this checkout: --use-this-python (the Python running this command does the work).
                 --allow-host <name>: the speech program also answers to that name (`tailscale serve`).
    secret       ask for the speech program's pass phrase (not shown as it is typed) and keep it in the
                 data folder; a running helper restarts the speech program with it. --clear removes it.
    uninstall    stop it and remove everything install wrote (what the Apps list's Uninstall runs)
    register     start-with-Windows + Start menu + start now (a setup.exe calls this after copying files)
    unregister   stop it, and remove start-with-Windows, the Start menu shortcuts and the data folder
"""
from __future__ import annotations

import argparse
import getpass
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


def host_list(values) -> list[str]:
    """--allow-host values (each may be comma-separated) as a clean list, no repeats."""
    out = []
    for v in values or ():
        for s in str(v).split(','):
            s = s.strip()
            if s and s not in out:
                out.append(s)
    return out


def install_settings(a) -> dict | None:
    """What `install` lays over the settings file, from its flags. None: nothing (the settings stay as they are)."""
    speech = {}
    if a.models_dir:
        speech['modelsDir'] = str(Path(a.models_dir).expanduser())
    if a.allow_host is not None:          # `--allow-host ""` empties the list
        speech['allowHosts'] = host_list(a.allow_host)
    return {'speech': speech} if speech else None


def ask_secret(ask=getpass.getpass) -> tuple[str | None, str]:
    """(the pass phrase, '') or (None, why not). Asked twice, never shown, never printed."""
    try:
        first = ask('Pass phrase for the speech program (not shown as you type): ')
        second = ask('The same again: ')
    except (EOFError, KeyboardInterrupt):
        return None, 'nothing was saved'
    if not first:
        return None, 'the pass phrase was empty; nothing was saved (to remove one: secret --clear)'
    if first != second:
        return None, 'the two did not match; nothing was saved'
    return first, ''


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog='nimrod_helper', description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('command', choices=['run', 'status', 'install', 'uninstall', 'register', 'unregister', 'secret'])
    ap.add_argument('--allow-host', action='append', default=None, metavar='NAME[,NAME...]',
                    help='install: the speech program also answers to this name, e.g. your-desktop.your-tailnet.ts.net '
                         'when `tailscale serve` gives it a secure address (speech_service/DESKTOP_SECOND_PASS.md)')
    ap.add_argument('--clear', action='store_true', help='secret: remove the pass phrase')
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
        hosts = (st.get('speech') or {}).get('allowHosts') or []
        if hosts:
            print(f'Speech program also answers to: {", ".join(map(str, hosts))}')
        print('Speech pass phrase: ' + ('set' if S.read_secret() else 'not set'))
        return 0

    if a.command == 'secret':
        if a.clear:
            gone = S.clear_secret()
            say([f'Removed the pass phrase ({S.secret_path()}).' if gone else 'There was no pass phrase to remove.'],
                a.quiet)
            return 0
        value, why = ask_secret(getpass.getpass)
        if value is None:
            print(why, file=sys.stderr)
            return 2
        where = S.write_secret(value)
        say([f'Saved the pass phrase in {where}.',
             'If the helper is running, it restarts the speech program with it within a few seconds.'], a.quiet)
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
        over = install_settings(a)
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
