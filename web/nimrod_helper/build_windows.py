"""Build the Windows package: py -3.13 nimrod_helper/build_windows.py --python-zip <file> [--sha256 <hash>]

WHAT IT MAKES, in nimrod_helper/build/:
    payload/python/   the helper's OWN Python: python.org's "embeddable package" for Windows, unzipped, with
                      the speech program's libraries (requirements-windows.txt) installed into it
    payload/app/      nimrod_helper, speech_service, media_agent/agent.py, and start_helper.pyw
    NimrodHelperSetup.exe   when Inno Setup 6 is on this machine (windows/nimrod_helper.iss); otherwise the
                      payload folder alone, which `python -m nimrod_helper install --payload` installs

*** WHY ITS OWN PYTHON, NOT "INSTALL PYTHON FIRST". *** Argued:
  * FOR requiring Python: about 200 MB smaller, and somebody who already has Python shares it.
  * AGAINST, and it wins: a typical person has no Python, and typing `python` on a Windows that has none
    opens the Microsoft Store - a dead end for the "standard user experience" Mike asked for (inbox AY
    item 2). The embeddable package is python.org's own build for exactly this (redistributable under the
    PSF licence), it touches no other Python on the machine, and its python.exe is signed by the Python
    Software Foundation - which matters for antivirus while our own setup.exe is unsigned.
  * NOT PyInstaller (one frozen .exe): frozen-Python executables are a well-known source of antivirus
    false alarms [training knowledge], the exact problem §nimrod-desktop-design Q4 warns about.

*** THE SPEECH MODEL IS NOT IN THE PACKAGE. *** faster-whisper fetches it (Systran/faster-whisper-small.en,
about 500 MB) from Hugging Face the first time the speech program starts, into the helper's data folder;
the status page says so while it happens. Putting it in would make a ~700 MB download that works offline.
That is a decision for Mike (listed in the 2026-10-07 report), so it is one flag away: --with-model.

Nothing here runs at install time on a person's computer: this is the BUILD, on the project's machine.
It downloads only when told to (--download), and checks a hash when given one.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parent
sys.path.insert(0, str(WEB))
from nimrod_helper import install_windows as W  # noqa: E402

PYTHON_VERSION = '3.13.13'           # the version the speech program is run and tested with here
REQUIREMENTS = HERE / 'requirements-windows.txt'
ISS = HERE / 'windows' / 'nimrod_helper.iss'


def embed_url(version: str = PYTHON_VERSION) -> str:
    return f'https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip'


def pth_name(version: str = PYTHON_VERSION) -> str:
    major, minor = version.split('.')[:2]
    return f'python{major}{minor}._pth'


def fixed_pth(text: str) -> str:
    """The embeddable package's ._pth with what the helper needs: its libraries (Lib\\site-packages), its own
    code (..\\app, so `-m nimrod_helper` and `-m speech_service` are found) and `import site` switched on.
    Every line python.org shipped is kept."""
    lines = [ln.rstrip() for ln in text.splitlines()]
    out = [ln for ln in lines if ln.strip() and ln.strip() not in ('#import site', 'import site')]
    for add in ('Lib\\site-packages', '..\\app'):
        if add not in out:
            out.append(add)
    out.append('import site')
    return '\n'.join(out) + '\n'


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def pip_command(site_packages: Path, version: str = PYTHON_VERSION) -> list[str]:
    """Install the requirements INTO the embeddable Python from this machine's pip: Windows wheels for that
    exact Python, binary only (nothing compiled on the build machine ends up in the package)."""
    major, minor = version.split('.')[:2]
    return [sys.executable, '-m', 'pip', 'install', '--target', str(site_packages), '--platform', 'win_amd64',
            '--python-version', f'{major}.{minor}', '--implementation', 'cp', '--only-binary=:all:',
            '--no-compile', '-r', str(REQUIREMENTS)]


def find_iscc() -> str | None:
    for p in (shutil.which('ISCC'), shutil.which('iscc'),
              os.path.join(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'), 'Inno Setup 6', 'ISCC.exe'),
              os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'Inno Setup 6', 'ISCC.exe')):
        if p and os.path.isfile(p):
            return p
    return None


def assemble(out: Path, python_zip: Path, run=subprocess.run, with_model: bool = False) -> Path:
    payload = out / 'payload'
    if payload.exists():
        shutil.rmtree(payload)
    py = payload / 'python'
    py.mkdir(parents=True)
    with zipfile.ZipFile(python_zip) as z:
        z.extractall(py)
    pth = py / pth_name()
    pth.write_text(fixed_pth(pth.read_text(encoding='utf-8') if pth.exists() else 'python313.zip\n.\n'),
                   encoding='utf-8')
    site = py / 'Lib' / 'site-packages'
    site.mkdir(parents=True, exist_ok=True)
    run(pip_command(site), check=True)
    W.copy_app(WEB, payload / 'app')
    W.mark(payload)                     # carried into the program folder, so uninstall knows it is ours
    if with_model:
        # The model in the package: the speech program then needs nothing from the internet.
        env = {**os.environ, 'HF_HOME': str(payload / 'models')}
        run([sys.executable, '-c', 'from faster_whisper import WhisperModel; WhisperModel("small.en", device="cpu", '
             'compute_type="int8")'], check=True, env=env)
    return payload


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--python-zip', help=f'python.org\'s embeddable package, already downloaded ({embed_url()})')
    ap.add_argument('--download', action='store_true', help='download it from python.org first')
    ap.add_argument('--sha256', help='refuse the zip unless its SHA-256 is this (python.org publishes it)')
    ap.add_argument('--with-model', action='store_true', help='put the speech model in the package (~500 MB more)')
    ap.add_argument('--out', default=str(HERE / 'build'))
    a = ap.parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    z = Path(a.python_zip) if a.python_zip else out / f'python-{PYTHON_VERSION}-embed-amd64.zip'
    if a.download and not z.exists():
        print(f'downloading {embed_url()}')
        urllib.request.urlretrieve(embed_url(), z)
    if not z.exists():
        print(f'no embeddable Python at {z}: pass --python-zip, or --download', file=sys.stderr)
        return 2
    digest = sha256(z)
    print(f'{z.name}: sha256 {digest}')
    if a.sha256 and a.sha256.lower() != digest:
        print('that is not the hash given: refusing to build with it', file=sys.stderr)
        return 2
    payload = assemble(out, z, with_model=a.with_model)
    print(f'payload: {payload}')
    iscc = find_iscc()
    if not iscc:
        print('Inno Setup 6 is not on this machine, so no setup.exe. The payload installs with:\n'
              f'  "{payload / "python" / "python.exe"}" "{payload / "app" / W.LAUNCHER}" install --payload "{payload}"')
        return 0
    subprocess.run([iscc, f'/DPayload={payload}', f'/O{out}', str(ISS)], check=True)
    print(f'setup: {out / "NimrodHelperSetup.exe"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
