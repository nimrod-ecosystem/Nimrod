#!/usr/bin/env bash
# nimrod-kiosk-pause.sh — the deliberate way out. Found missing 2026-09-19: Mike plugged a
# projector into a real Pi to test it as a second monitor, pressed Alt+F4 to get to the
# desktop, and the kiosk relaunched itself before he had time to do anything — "the device is
# effectively bricked for any other uses."
#
# *** WHY THIS IS A SEPARATE SCRIPT AND NOT "JUST CHANGE Restart= TO on-failure". ***
# `Restart=always` is not an oversight — it is the same crash-resilience this whole project
# insists on everywhere else ("a screen in a care facility ends up frozen... until somebody
# visits"). Loosening it so a graceful Chromium exit (Alt+F4) does not restart would ALSO mean
# an accidental close from anyone near the keyboard leaves the screen dark until a human
# notices, which is a worse failure than the one being fixed here — Christine cannot reach for
# anything herself, but staff, visitors or a stray cable are all real ways a keyboard gets
# brushed near a bedside screen.
#
# So the fix is not to weaken the automatic restart; it is to add a DELIBERATE action that
# bypasses it on purpose. `systemctl --user stop` is never re-triggered by Restart=, no matter
# what the policy is — a stop is an administrative act, not a process exit. This script is
# that act, bound to a key combo four keys long specifically so it is not something a brushed
# keyboard triggers by accident (see the labwc keybind this installer adds).
set -euo pipefail

systemctl --user stop nimrod-kiosk.service || true

# A bare desktop with nothing on it answers "did this work" but not "now what" — try to put a
# terminal in front of whoever just did this, gracefully degrading rather than failing if none
# of these happen to be installed. Not required for the fix to work: the kiosk is already
# stopped by the line above regardless of what happens from here down.
for term in lxterminal x-terminal-emulator xterm foot alacritty; do
  if command -v "$term" >/dev/null 2>&1; then
    "$term" >/dev/null 2>&1 &
    disown
    break
  fi
done
