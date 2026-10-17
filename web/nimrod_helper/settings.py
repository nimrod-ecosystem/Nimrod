"""The helper's settings, and where its files live.

ONE SMALL JSON FILE in the helper's data folder. Every value has a default (DEFAULTS, each argued), a
missing or broken file means "the defaults", and nothing here is ever sent anywhere: these are facts
about THIS computer (which parts run, on which ports), which is why they live here and not on the
account (MIKE_CHANGE_LIST §nimrod-desktop-design, the addendum: "machine-specific facts stay local").
"""
from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

# *** THE DEFAULTS, each argued (hard-coded values are listed in the 2026-10-07 report). ***
DEFAULTS = {
    'version': 1,
    # Where the person's Nimrod is. The media agent pairs with it and allows it (CORS); the status
    # endpoint allows it. nimrodecosystem.com is the address the site is served at today (CLAUDE.md's
    # deploy check); a self-hosted Nimrod changes this one line.
    'platform': 'https://nimrodecosystem.com',
    # Other sites allowed to read /status besides `platform` (and any page on this computer itself).
    # The older address still serves the same site. www.nimrodecosystem.com is NOT here: checked 2026-10-07, it
    # answers every path with a 301 to the bare address, so no page is ever served from it. If it ever serves
    # pages itself, add it here and to speech_service/service.py DEFAULT_SITES (test_helper.py keeps them equal).
    'alsoAllow': ['https://nimrod.onrender.com'],
    # The helper's own status page. 8790: free beside the ports already used here (8765 a receiver,
    # 8770-8773 media agents, 8791 corpus desk, 8796 own voice model, 8797 speech, 8798 the wake example).
    'statusPort': 8790,
    # THE PERSON'S NIMROD FOLDER ON THIS COMPUTER (row 2.49, the folder tree's step 4): its full path, or '' (the
    # default: nothing changes). Set, it is where the parts look first:
    #   * speech: passed as --root, so it finds "Voice model" there (speech_service reads the same root);
    #   * media, once turned on with no folder of its own: its "Pictures" is the folder served, and its "Data" is
    #     where the agent keeps history (--data-dir) - the same place a screen's browser writes it.
    # It never turns media on by itself: serving a folder stays a choice (the media block below).
    'nimrodFolder': '',
    'speech': {
        # ON: speech is the reason this package exists today (inbox AZ item 1). It only listens to what a
        # page on this computer sends it; it opens no microphone of its own.
        'on': True,
        # The site's "this screen" recogniser looks here (speech_engines.js LOCAL_URL). Changing it means
        # changing the screen's "address" setting too.
        'port': 8797,
        # speech_service's own defaults: faster-whisper, small.en, measured on this desktop (2026-09-30).
        # 'fake' answers the protocol with no model (the tests).
        'backend': 'whisper',
        'model': 'small.en',
        # Where the speech model is kept. Empty: inside the helper's data folder, so uninstalling removes
        # it too. A path: an existing model cache (nothing is downloaded when the model is already there).
        'modelsDir': '',
        # Other names the speech program answers to, passed as --allow-host: the secure name a proxy on this
        # computer gives it (`tailscale serve`, speech_service/DESKTOP_SECOND_PASS.md), e.g.
        # ['your-desktop.your-tailnet.ts.net']. Empty: only this computer's own names (127.0.0.1, localhost),
        # which is right for everybody whose screen is this computer. A name here is not a secret: the pass
        # phrase that goes with it is kept apart from this file (SECRET_FILE, below).
        'allowHosts': [],
    },
    'media': {
        # OFF until a folder is chosen: serving a folder is a choice about somebody's pictures, never a
        # default.
        'on': False,
        'folder': '',
        'port': 8770,
        'name': 'This computer',
    },
}


def merged(base: dict, over: dict) -> dict:
    """`base` with `over` laid on top, one level of nesting deep; unknown keys in `over` are kept."""
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **v}
        else:
            out[k] = v
    return out


def load(path) -> tuple[dict, str]:
    """(settings, problem): the defaults with the file laid over them. problem is '' or why the file was
    not used (a broken file is never fatal: the helper still runs on its defaults, and says so)."""
    p = Path(path)
    if not p.exists():
        return copy.deepcopy(DEFAULTS), ''
    try:
        data = json.loads(p.read_text(encoding='utf-8-sig'))
        if not isinstance(data, dict):
            return copy.deepcopy(DEFAULTS), f'{p} is not a settings object; using the defaults'
        return merged(DEFAULTS, data), ''
    except (OSError, ValueError) as err:
        return copy.deepcopy(DEFAULTS), f'{p} could not be read ({err}); using the defaults'


def save(path, settings: dict) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(settings, indent=2), encoding='utf-8')
    os.replace(tmp, p)


# ---------------------------------------------------------------------------------------------
# WHERE THINGS LIVE. Per user, never a system folder: no administrator password, and one person's
# helper is not another's. The program and its data are apart, so a new version replaces the program
# without losing the downloaded model or the settings.
# ---------------------------------------------------------------------------------------------
APP_NAME = 'Nimrod Helper'


def local_appdata() -> Path:
    v = os.environ.get('LOCALAPPDATA')
    return Path(v) if v else Path.home() / 'AppData' / 'Local'


def data_dir() -> Path:
    """Settings, logs, the speech model. NIMROD_HELPER_DATA overrides (the tests)."""
    v = os.environ.get('NIMROD_HELPER_DATA')
    if v:
        return Path(v)
    if sys.platform == 'win32':
        return local_appdata() / APP_NAME
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / APP_NAME
    return Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local' / 'share') / 'nimrod-helper'


def install_dir() -> Path:
    """The program. Windows: where per-user programs go (%LOCALAPPDATA%\\Programs)."""
    v = os.environ.get('NIMROD_HELPER_HOME')
    if v:
        return Path(v)
    if sys.platform == 'win32':
        return local_appdata() / 'Programs' / APP_NAME
    if sys.platform == 'darwin':
        return Path.home() / 'Applications' / APP_NAME
    return Path.home() / '.local' / 'lib' / 'nimrod-helper'


def settings_path(d: Path | None = None) -> Path:
    return (d or data_dir()) / 'settings.json'



# ---------------------------------------------------------------------------------------------
# THE SPEECH PROGRAM'S PASS PHRASE (2026-10-12, inbox BV). Needed when a screen on ANOTHER computer sends this
# one its room's sound (allowHosts above): the speech program then refuses any screen that does not send it.
#
# *** WHERE IT LIVES, argued. *** Its own one-line file in the data folder, NOT in settings.json:
#   * FOR settings.json: one file, one place to look.
#   * AGAINST, and it wins: settings.json is the file a person opens, copies into a message to ask for help, or
#     reads aloud; the pass phrase must not ride along. Apart, it can be set, changed and removed on its own
#     (`python -m nimrod_helper secret`, which asks for it without showing it, so it never sits in a command
#     history either).
#   * Windows Credential Manager / DPAPI were considered: they encrypt it at rest, but any program running as
#     the same person can still ask for it back, which is exactly who can read this file. What they add is
#     protection from a copied disk or backup, and the data folder (%LOCALAPPDATA%) is not roamed or synced by
#     OneDrive. Not worth a file nobody can open to check.
#   * WHO CAN READ IT: the folder inherits the user profile's permissions - that Windows account, SYSTEM and the
#     computer's administrators; not other ordinary accounts. Uninstalling deletes it with the data folder.
# HOW IT REACHES THE SPEECH PROGRAM: the NIMROD_SPEECH_SECRET environment variable of that one child process
# (supervisor.plan), never `--secret` on its command line: the supervisor writes each command line to the part's
# log, and Task Manager shows command lines. It is never in /status, a log, helper.pids or install_record.json.
# ---------------------------------------------------------------------------------------------
SECRET_FILE = 'speech_secret.txt'


def secret_path(d: Path | None = None) -> Path:
    return (d or data_dir()) / SECRET_FILE


def read_secret(d: Path | None = None) -> str | None:
    """The pass phrase, or None when there is no file or it is empty. Line endings an editor adds are dropped;
    nothing else is changed (the screen sends exactly what was typed there)."""
    try:
        v = secret_path(d).read_text(encoding='utf-8-sig').rstrip('\r\n')
    except OSError:
        return None
    return v or None


def write_secret(value: str, d: Path | None = None) -> Path:
    p = secret_path(d)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix('.tmp')
    tmp.write_text(value, encoding='utf-8')
    os.replace(tmp, p)
    return p


def clear_secret(d: Path | None = None) -> bool:
    try:
        secret_path(d).unlink()
        return True
    except OSError:
        return False


def models_dir(settings: dict, d: Path | None = None) -> Path:
    v = str((settings.get('speech') or {}).get('modelsDir') or '').strip()
    return Path(os.path.expanduser(v)) if v else (d or data_dir()) / 'models'
