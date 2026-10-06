#!/usr/bin/env bash
# nimrod-kiosk-back.sh — BRING THE DASHBOARD BACK (2026-10-05; "Lock this screen", nimrod-lock-helper.py).
#
# When somebody has unlocked the screen and closed the kiosk to use the computer (a film in the TV window), the
# kiosk service is not relaunched (the launcher exits 75). This puts it back: bound to Ctrl+Alt+Shift+Return by
# install-linux.sh. Starting a service that is already running does nothing, so a stray press costs nothing.
# It is the one Nimrod keybind that stays while the screen is LOCKED (the helper keeps any keybind whose command
# runs this script), because bringing the dashboard back is never a way out.
set -uo pipefail
systemctl --user reset-failed nimrod-kiosk.service 2>/dev/null || true
systemctl --user start nimrod-kiosk.service
