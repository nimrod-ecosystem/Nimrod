"""nimrod_helper - THE ONE INSTALL PACKAGE for a computer (DECISIONS 2026-10-07 item 3).

Mike, 2026-10-07: *"We were already discussing a larger package for people to install. If it's
necessary for this then make it part of that package."* So the speech program (web/speech_service)
does not get an installer of its own: it ships inside this one package, with the media agent
(web/media_agent), and whatever the package carries later (MIKE_CHANGE_LIST §nimrod-desktop-design).

What is here:
    settings.py         the helper's own settings file, with defaults (which parts run, their ports)
    supervisor.py       `run`: starts each part, restarts one that stops, answers /status on 127.0.0.1
    install_windows.py  `install` / `uninstall` (per-user, no administrator) and `register` /
                        `unregister` (what a setup.exe calls), all of it recorded so removal is exact
    build_windows.py    assembles the Windows package: its own copy of Python, the speech program's
                        libraries, this code, and (when Inno Setup is on the build machine) a setup.exe
    windows/nimrod_helper.iss   the Inno Setup script build_windows.py compiles
    test_helper.py      the tests (no download, no registry: a fake registry and temporary folders)

Run, from web/:
    py -3.13 -m nimrod_helper run          the supervisor, in the foreground (Ctrl+C stops it)
    py -3.13 -m nimrod_helper status       what is running, from its /status
    py -3.13 -m nimrod_helper install --use-this-python     install from this checkout (development)
    py -3.13 -m nimrod_helper uninstall    remove everything install wrote
"""

VERSION = '0.1.0'
