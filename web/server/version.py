"""version.py - WHAT VERSION OF THE SITE THIS SERVER IS SERVING, so a screen can notice a deploy.

The finding (bench soak, 2026-10-04): a screen never picks up a deploy. The bench's browser had been
up 41 hours showing the page it last loaded, one deploy behind, because nothing ever reloads it. The
kiosk now polls `GET /api/version` and reloads itself at a quiet moment when the answer changes
(client: version_watch.js). This file is the server's half: one short string, computed once.

*** THE VERSION IS A HASH OF THE CLIENT CODE THIS SERVER SERVES, NOT THE COMMIT. *** Argued:
  FOR the commit (Render sets RENDER_GIT_COMMIT for every git-backed deploy): it is free, and it is
     exactly "which deploy is this".
  AGAINST, and it wins as the thing screens COMPARE: a deploy that changes only the server, the docs
     or a test page would blank every screen for a reload that changes nothing on them. What a screen
     needs to know is "is the code I am running still the code being served", and the code is the
     answer to that. It also works the same everywhere - a laptop, the bench pointed at a dev server,
     a host that is not Render - with nothing to configure.
  The commit is still REPORTED beside it (`commit`, null when the host does not say), because "which
  deploy is that screen on" is the first question anybody asks when a screen looks wrong.

What is hashed: every .html/.js/.css/.json under web/client, path and bytes, EXCEPT the `dev/` test
pages (no screen loads them) and dot-folders. About 150 files and 2 MB today: a few milliseconds, once,
at startup. Media is left out on purpose - a new photo is not new code, and the bytes are big.

If hashing fails (an unreadable file), the version falls back to the server's start time. Argued: the
cost is one reload per server restart, on screens that are idle; the alternative - no version at all -
is the bug this exists to fix.
"""
from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path

CODE_SUFFIXES = (".html", ".js", ".css", ".json")
# Folder NAMES skipped at any depth. `dev` holds the test pages; the rest are never served code.
SKIP_DIRS = frozenset({"dev", "__pycache__", "node_modules"})
VERSION_LEN = 16          # hex characters: 64 bits, far past any chance of two deploys colliding


def code_files(root: Path) -> list[Path]:
    """The files the version is made of, in a fixed order (sorted by their path under `root`)."""
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in filenames:
            if name.endswith(CODE_SUFFIXES):
                out.append(Path(dirpath) / name)
    out.sort(key=lambda p: p.relative_to(root).as_posix())
    return out


def code_version(root: Path) -> str:
    """A short hash of the served client code. Same files, same bytes -> same string, on any machine."""
    h = hashlib.sha256()
    for p in code_files(root):
        h.update(p.relative_to(root).as_posix().encode("utf-8"))
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    return h.hexdigest()[:VERSION_LEN]


def safe_code_version(root: Path, clock=time.time) -> str:
    """`code_version`, or `start-<seconds>` when the files cannot be read (see the header)."""
    try:
        return code_version(root)
    except OSError:
        return f"start-{int(clock())}"


def deploy_commit(env=None) -> str | None:
    """The deploy's commit when the host says (Render: RENDER_GIT_COMMIT), shortened; else None."""
    e = os.environ if env is None else env
    c = (e.get("RENDER_GIT_COMMIT") or "").strip()
    return c[:12] if c else None
