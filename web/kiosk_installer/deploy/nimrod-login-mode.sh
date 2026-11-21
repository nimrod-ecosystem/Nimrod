#!/usr/bin/env bash
# nimrod-login-mode.sh — WHAT THIS COMPUTER OPENS WHEN SOMEBODY LOGS IN (2026-11-20, row 2.273).
#
# Mike, 2026-11-19: "I want the pies to not be locked into Nimrod. I want to be able to just use them like regular
# Raspberry Pis and just use Nimrod like a website." So the kiosk becomes one choice of four, per computer:
#
#   ./nimrod-login-mode.sh window       an ordinary Chromium window opens on Nimrod at login, maximised. Closed is closed.
#   ./nimrod-login-mode.sh fullscreen   the same window, started full screen (F11 leaves full screen; it is still a browser).
#   ./nimrod-login-mode.sh kiosk        the kiosk, as installed before: no browser around it, relaunched after any exit.
#   ./nimrod-login-mode.sh none         nothing opens; Nimrod is a website like any other.
#   add --now to switch at once instead of at the next login.
#
# Whatever is chosen, "Nimrod full screen" in the computer's menu (and Ctrl+Alt+Shift+Return) starts the kiosk until the
# next login or Ctrl+Alt+Shift+Esc; it refuses, and says so, while an ordinary Chromium window is open on the same profile.
#
# WHAT IT CHANGES, all in this user's home, no sudo:
#   ~/.config/systemd/user/nimrod-browser.service   written from the kiosk unit's own settings (address, voice, helper,
#                                                   name), with NIMROD_LAUNCH_MODE and Restart=no
#   ~/.config/systemd/user/nimrod-kiosk.service     enabled for `kiosk`, disabled otherwise (it starts at login if enabled)
#   ~/.config/labwc/autostart                       its one Nimrod start line, replaced; every other line kept; a backup
#   ~/.local/share/applications/nimrod-dashboard.desktop   "Nimrod full screen"
# The kiosk unit itself is never deleted, so `kiosk` always works again.
#
# NOT COVERED IN A WINDOW, said plainly: the "Aw, Snap" watchdog (nimrod-lock-helper.py) brings back only the kiosk. A crashed
# page in an ordinary window shows Chromium's own Reload button until somebody presses it.
set -euo pipefail

MODE="${1:-}"; NOW=0
[ "${2:-}" = "--now" ] && NOW=1
case "$MODE" in window|fullscreen|kiosk|none) ;; *)
  echo "usage: $0 window|fullscreen|kiosk|none [--now]" >&2; exit 2 ;; esac

UNIT_DIR="$HOME/.config/systemd/user"
KIOSK_UNIT="$UNIT_DIR/nimrod-kiosk.service"
BROWSER_UNIT="$UNIT_DIR/nimrod-browser.service"
AUTOSTART="${NIMROD_AUTOSTART:-$HOME/.config/labwc/autostart}"
APPS_DIR="$HOME/.local/share/applications"
BACK="$HOME/.local/bin/nimrod-kiosk-back.sh"
SYSTEMCTL="${NIMROD_SYSTEMCTL:-systemctl}"     # a seam for the test

[ -f "$KIOSK_UNIT" ] || { echo "no $KIOSK_UNIT: run install-linux.sh first (it holds the address and the settings)" >&2; exit 1; }

# 1. the window's unit, from the kiosk's: the same Environment= lines and launcher, so the window opens exactly the page the
#    kiosk did. Rewritten every time, so a changed address in the kiosk unit reaches it.
ENV_LINES="$(grep -E '^Environment=' "$KIOSK_UNIT" | grep -v '^Environment=NIMROD_LAUNCH_MODE=' || true)"
EXEC_LINE="$(grep -E '^ExecStart=' "$KIOSK_UNIT" | head -n 1)"
[ -n "$EXEC_LINE" ] || { echo "$KIOSK_UNIT has no ExecStart= line" >&2; exit 1; }
WIN_MODE="window"; [ "$MODE" = "fullscreen" ] && WIN_MODE="fullscreen"
mkdir -p "$UNIT_DIR"
cat > "$BROWSER_UNIT" <<EOF
[Unit]
Description=Nimrod in an ordinary browser window (opened once at login; never relaunched)
After=graphical-session.target

[Service]
Type=simple
$ENV_LINES
Environment=NIMROD_LAUNCH_MODE=$WIN_MODE
$EXEC_LINE
Restart=no
EOF

# 2. the kiosk unit: enabled only when it is the choice (an enabled unit starts with the session, autostart or not).
"$SYSTEMCTL" --user daemon-reload
if [ "$MODE" = "kiosk" ]; then
  "$SYSTEMCTL" --user enable nimrod-kiosk.service >/dev/null 2>&1 || true
else
  "$SYSTEMCTL" --user disable nimrod-kiosk.service >/dev/null 2>&1 || true
fi

# 3. autostart: only the Nimrod start line changes. Backed up first, as install-linux.sh does.
mkdir -p "$(dirname "$AUTOSTART")"
touch "$AUTOSTART"
cp "$AUTOSTART" "$AUTOSTART.bak.$(date +%Y%m%d%H%M%S)"
NONE_NOTE="# (nimrod-login-mode.sh none: nothing of Nimrod's opens at login)"
case "$MODE" in
  kiosk) START='systemctl --user start nimrod-kiosk.service' ;;
  window|fullscreen) START='systemctl --user start nimrod-browser.service' ;;
  none) START="$NONE_NOTE" ;;
esac
{ grep -v -x -F "$NONE_NOTE" "$AUTOSTART" | grep -v -E '^systemctl --user start nimrod-(kiosk|browser)\.service' || true
  printf '%s\n' "$START"; } > "$AUTOSTART.new"
mv "$AUTOSTART.new" "$AUTOSTART"

# 4. the way into full screen, in the computer's own menu.
mkdir -p "$APPS_DIR"
cat > "$APPS_DIR/nimrod-dashboard.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Nimrod full screen
Comment=Nimrod on the whole screen, no browser around it (Ctrl+Alt+Shift+Esc leaves it)
Exec=$BACK
Icon=video-display
Terminal=false
Categories=Utility;
EOF

# 5. --now: switch while this session runs.
if [ "$NOW" = "1" ]; then
  case "$MODE" in
    kiosk) "$SYSTEMCTL" --user stop nimrod-browser.service 2>/dev/null || true
           "$SYSTEMCTL" --user reset-failed nimrod-kiosk.service 2>/dev/null || true
           "$SYSTEMCTL" --user start nimrod-kiosk.service ;;
    window|fullscreen) "$SYSTEMCTL" --user stop nimrod-kiosk.service 2>/dev/null || true
           "$SYSTEMCTL" --user start nimrod-browser.service ;;
    none)  "$SYSTEMCTL" --user stop nimrod-kiosk.service 2>/dev/null || true ;;
  esac
fi

echo "at login: $MODE$([ "$NOW" = "1" ] && echo ' (and now)')"
[ -f /etc/chromium/policies/managed/nimrod-site.json ] || [ "$MODE" = "kiosk" ] || [ "$MODE" = "none" ] || \
  echo "  NOTE: no site policy yet (install-linux.sh NIMROD_SITE_POLICY=1, sudo): the window lets every site play sound, and asks once for the camera"
[ -f /etc/chromium/policies/recommended/nimrod-start.json ] || \
  echo "  NOTE: Chromium opened from the menu starts on its own start page until NIMROD_SITE_POLICY=1 sets Nimrod as it"
