#!/usr/bin/env bash
# nimrod-login-mode.sh — WHAT THIS COMPUTER OPENS WHEN SOMEBODY LOGS IN (2026-11-20, row 2.273).
#
# Mike, 2026-11-19: "I want the pies to not be locked into Nimrod. I want to be able to just use them like regular
# Raspberry Pis and just use Nimrod like a website." So the kiosk becomes one choice of four, per computer:
#
#   ./nimrod-login-mode.sh window       an ordinary Chromium window opens on Nimrod at login, maximised.
#   ./nimrod-login-mode.sh fullscreen   the same window, started full screen (F11 leaves full screen; it is still a browser).
#   ./nimrod-login-mode.sh kiosk        the kiosk, as installed before: no browser around it, relaunched after any exit.
#   ./nimrod-login-mode.sh none         nothing opens; Nimrod is a website like any other.
#   options:  --now        switch at once instead of at the next login
#             --no-watch   (window/fullscreen) the "Aw, Snap" watchdog leaves the window alone
#
# A WINDOW IS NOT LOCKED, AND IS NOT LEFT DEAD EITHER (the gate, 2026-11-20). Two different exits, two different answers:
#   - A PERSON CLOSES IT (the last window closed, Chromium exits cleanly, status 0): it stays closed. That is Mike's ruling.
#   - IT DIES (Chromium killed for memory, or crashed: a non-zero status or a signal): nimrod-browser.service brings it back
#     (Restart=on-failure, 3 s). Nobody chose that, and on a screen whose person cannot press anything a vanished page is
#     the state CLAUDE.md forbids.
#   - THE PAGE CRASHES INSIDE A LIVE BROWSER ("Aw, Snap"): the lock helper's watchdog watches this unit instead of the kiosk's
#     (a drop-in sets NIMROD_KIOSK_UNIT=nimrod-browser.service) and restarts it, which closes and reopens the WHOLE browser,
#     other tabs included. --no-watch turns that off for a computer where other tabs matter more (a TV used for films).
#     ARGUED, on by default: it acts only after Nimrod's page has already crashed AND stopped reporting, so on the screen it
#     exists for there is nothing left to lose; on a TV, losing a film's tab to it is the price, and the switch is here.
#
# Whatever is chosen, "Nimrod full screen" in the computer's menu (and Ctrl+Alt+Shift+Return) starts the kiosk until the
# next login or Ctrl+Alt+Shift+Esc; it refuses, and says so, while an ordinary Chromium window is open on the same profile.
#
# WHAT IT CHANGES, all in this user's home, no sudo (the site's sound/camera policy is nimrod-site-policy.sh, sudo):
#   ~/.config/systemd/user/nimrod-browser.service              written from the kiosk unit's own settings
#   ~/.config/systemd/user/nimrod-lock-helper.service.d/watch.conf   the watchdog's unit (window/fullscreen, not --no-watch)
#   ~/.config/systemd/user/nimrod-kiosk.service                enabled for `kiosk`, disabled otherwise (checked, not assumed)
#   ~/.config/labwc/autostart                                  any line starting a Nimrod unit replaced by one; a backup kept
#   ~/.local/share/applications/nimrod-dashboard.desktop       "Nimrod full screen"
# The kiosk unit itself is never deleted, so `kiosk` always works again.
set -euo pipefail

MODE=""; NOW=0; WATCH=1
for a in "$@"; do
  case "$a" in
    --now) NOW=1 ;;
    --no-watch) WATCH=0 ;;
    window|fullscreen|kiosk|none) MODE="$a" ;;
    *) MODE="bad" ;;
  esac
done
case "$MODE" in window|fullscreen|kiosk|none) ;; *)
  echo "usage: $0 window|fullscreen|kiosk|none [--now] [--no-watch]" >&2; exit 2 ;; esac

UNIT_DIR="$HOME/.config/systemd/user"
KIOSK_UNIT="$UNIT_DIR/nimrod-kiosk.service"
BROWSER_UNIT="$UNIT_DIR/nimrod-browser.service"
HELPER_UNIT="$UNIT_DIR/nimrod-lock-helper.service"
WATCH_DROPIN="$UNIT_DIR/nimrod-lock-helper.service.d/watch.conf"
AUTOSTART="${NIMROD_AUTOSTART:-$HOME/.config/labwc/autostart}"
APPS_DIR="$HOME/.local/share/applications"
BACK="$HOME/.local/bin/nimrod-kiosk-back.sh"
SYSTEMCTL="${NIMROD_SYSTEMCTL:-systemctl}"     # seams for the test
NOW_WAIT_S="${NIMROD_NOW_WAIT_S:-6}"

[ -f "$KIOSK_UNIT" ] || { echo "no $KIOSK_UNIT: run install-linux.sh first (it holds the address and the settings)" >&2; exit 1; }
ENV_LINES="$(grep -E '^Environment=' "$KIOSK_UNIT" | grep -v '^Environment=NIMROD_LAUNCH_MODE=' || true)"
EXEC_LINE="$(grep -E '^ExecStart=' "$KIOSK_UNIT" || true)"
EXEC_LINE="${EXEC_LINE%%$'\n'*}"
[ -n "$EXEC_LINE" ] || { echo "$KIOSK_UNIT has no ExecStart= line" >&2; exit 1; }

# 1. the window's unit, from the kiosk's: the same Environment= lines and launcher, so the window opens exactly the page the
#    kiosk did. Rewritten every time, so a changed address in the kiosk unit reaches it.
WIN_MODE="window"; [ "$MODE" = "fullscreen" ] && WIN_MODE="fullscreen"
mkdir -p "$UNIT_DIR"
cat > "$BROWSER_UNIT" <<EOF
[Unit]
Description=Nimrod in an ordinary browser window (a person closing it closes it; a crash brings it back)
After=graphical-session.target

[Service]
Type=simple
$ENV_LINES
Environment=NIMROD_LAUNCH_MODE=$WIN_MODE
$EXEC_LINE
Restart=on-failure
RestartSec=3
EOF

# 2. the watchdog's unit, for a window (a drop-in on the helper; removed for kiosk, none and --no-watch).
if [ "$WATCH" = "1" ] && { [ "$MODE" = "window" ] || [ "$MODE" = "fullscreen" ]; }; then
  mkdir -p "$(dirname "$WATCH_DROPIN")"
  printf '[Service]\nEnvironment=NIMROD_KIOSK_UNIT=nimrod-browser.service\n' > "$WATCH_DROPIN"
else
  rm -f "$WATCH_DROPIN"
fi

# 3. the kiosk unit: enabled only when it is the choice (an enabled unit starts with the session, autostart or not). Checked
#    afterwards: a kiosk left enabled would race the window for the profile at every login, so a failure stops here, before
#    autostart is touched.
"$SYSTEMCTL" --user daemon-reload
if [ "$MODE" = "kiosk" ]; then
  "$SYSTEMCTL" --user enable nimrod-kiosk.service >/dev/null 2>&1 || true
else
  "$SYSTEMCTL" --user disable nimrod-kiosk.service >/dev/null 2>&1 || true
  if [ "$("$SYSTEMCTL" --user is-enabled nimrod-kiosk.service 2>/dev/null || true)" = "enabled" ]; then
    echo "nimrod-login-mode: nimrod-kiosk.service is still enabled; nothing else changed. Try: systemctl --user disable nimrod-kiosk" >&2
    exit 1
  fi
fi
[ -f "$HELPER_UNIT" ] && { "$SYSTEMCTL" --user restart nimrod-lock-helper.service 2>/dev/null || true; }

# 4. autostart: every line that starts a Nimrod unit goes (wherever on the line, so `a && systemctl --user start
#    nimrod-kiosk.service` goes too; the backup keeps it), and one line for the choice is added. Every other line kept.
mkdir -p "$(dirname "$AUTOSTART")"
touch "$AUTOSTART"
cp "$AUTOSTART" "$AUTOSTART.bak.$(date +%Y%m%d%H%M%S)"
NONE_NOTE="# (nimrod-login-mode.sh none: nothing of Nimrod's opens at login)"
case "$MODE" in
  kiosk) START='systemctl --user start nimrod-kiosk.service' ;;
  window|fullscreen) START='systemctl --user start nimrod-browser.service' ;;
  none) START="$NONE_NOTE" ;;
esac
{ grep -v -x -F "$NONE_NOTE" "$AUTOSTART" | grep -v -E 'systemctl --user start nimrod-(kiosk|browser)\.service' || true
  printf '%s\n' "$START"; } > "$AUTOSTART.new"
mv "$AUTOSTART.new" "$AUTOSTART"

# 5. the way into full screen, in the computer's own menu.
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

# 6. --now: switch while this session runs, and SAY whether it worked (a kiosk started into an open browser stays out).
#    Going back to the kiosk stops nimrod-browser.service, which closes every Chromium window opened since login.
if [ "$NOW" = "1" ]; then
  case "$MODE" in
    kiosk) "$SYSTEMCTL" --user stop nimrod-browser.service 2>/dev/null || true
           "$SYSTEMCTL" --user reset-failed nimrod-kiosk.service 2>/dev/null || true
           "$SYSTEMCTL" --user start nimrod-kiosk.service; WANT=nimrod-kiosk.service ;;
    window|fullscreen) "$SYSTEMCTL" --user stop nimrod-kiosk.service 2>/dev/null || true
           "$SYSTEMCTL" --user start nimrod-browser.service; WANT=nimrod-browser.service ;;
    none)  "$SYSTEMCTL" --user stop nimrod-kiosk.service 2>/dev/null || true; WANT="" ;;
  esac
  if [ -n "$WANT" ]; then
    sleep "$NOW_WAIT_S"
    if ! "$SYSTEMCTL" --user is-active --quiet "$WANT"; then
      echo "nimrod-login-mode: $WANT is not running after ${NOW_WAIT_S}s (journalctl --user -u $WANT). A Chromium window open from the menu keeps the kiosk out: close it first." >&2
      exit 1
    fi
  fi
fi

echo "at login: $MODE$([ "$NOW" = "1" ] && echo ' (and now)')$([ "$WATCH" = "0" ] && echo ', watchdog off')"
if [ "$MODE" = "window" ] || [ "$MODE" = "fullscreen" ]; then
  [ -f /etc/chromium/policies/managed/nimrod-site.json ] || \
    echo "  NOTE: no site policy yet (nimrod-site-policy.sh, sudo): the window lets every site play sound, and asks once for the camera"
fi
