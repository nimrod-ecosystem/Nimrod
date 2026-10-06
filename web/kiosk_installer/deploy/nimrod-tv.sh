#!/usr/bin/env bash
# nimrod-tv.sh — A SEPARATE, ORDINARY BROWSER WINDOW FOR A FILM (2026-10-05; "Lock this screen").
#
# Mike: "I'd like to be able to stay out of it though when I unlock, so we can watch Netflix and stuff." Bound to
# Ctrl+Alt+Shift+T by install-linux.sh. It opens Chromium with ITS OWN profile (not the kiosk's: no device key, no
# kiosk flags, its own sign-ins), maximised, at $NIMROD_TV_URL.
#
# REFUSED WHILE THE SCREEN IS LOCKED (nimrod-lock-helper.py --check locked): an ordinary browser window is the whole
# computer and every website's sign-in, which is exactly what a lock keeps out. A screen whose page never reported
# (no helper, or nobody ever locked it) is today's screen, and the window opens.
#
# HARD-CODED, with the case: NIMROD_TV_URL defaults to https://www.netflix.com/ because that is what Mike named;
# the unit or the keybind can set any other address. Netflix needs the Widevine module (libwidevinecdm0); this
# script says so in the journal if it is missing, and opens the window anyway (other sites still play).
set -uo pipefail
HELPER="${NIMROD_LOCK_HELPER:-$HOME/.local/bin/nimrod-lock-helper.py}"
TV_URL="${NIMROD_TV_URL:-https://www.netflix.com/}"
TV_PROFILE="${NIMROD_TV_PROFILE:-$HOME/.config/nimrod-tv}"

if [ -f "$HELPER" ] && python3 "$HELPER" --check locked; then
  echo "nimrod-tv: this screen is locked; the TV window waits until it is unlocked." >&2
  command -v notify-send >/dev/null 2>&1 && notify-send "This screen is locked" "Unlock it on the dashboard first." || true
  exit 1
fi
if [ ! -d /opt/WidevineCdm ] && ! dpkg -s libwidevinecdm0 >/dev/null 2>&1; then
  echo "nimrod-tv: no Widevine module here (libwidevinecdm0): Netflix and similar will not play." >&2
fi
mkdir -p "$TV_PROFILE"
rm -f "$TV_PROFILE/SingletonLock" "$TV_PROFILE/SingletonSocket" "$TV_PROFILE/SingletonCookie" 2>/dev/null || true
nohup chromium --ozone-platform=wayland --user-data-dir="$TV_PROFILE" --no-first-run --start-maximized \
  --password-store=basic "$TV_URL" >/dev/null 2>&1 &
disown
