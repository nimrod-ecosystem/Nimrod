#!/usr/bin/env bash
# Nimrod kiosk launcher — the part systemd supervises.
#
# Everything here existed before, in ~/.config/labwc/autostart's own `while true` loop.
# It still does the same two things, in the same order, for the same reasons — only the
# SUPERVISION moved. Before: a background shell loop nobody could inspect except by reading
# its own source. Now: `systemctl --user status nimrod-kiosk` shows the truth — is it running,
# how many times has it restarted, what did it print — because systemd owns the restart, not a
# `while true` this script no longer needs.
#
# Installed by install-linux.sh, which fills in NIMROD_KIOSK_URL in the unit file. Not meant to
# be edited per-machine — edit the URL in `~/.config/systemd/user/nimrod-kiosk.service` instead
# (or re-run the installer with a different URL).
set -euo pipefail

URL="${NIMROD_KIOSK_URL:?set NIMROD_KIOSK_URL in the systemd units Environment= line}"
PROFILE="${NIMROD_KIOSK_PROFILE:-$HOME/.config/chromium}"

# Wait for the network to actually be reachable before the first navigation — a kiosk that
# never auto-reloads must not get stuck on a "can't connect" page because Chromium's first
# paint raced the network coming up. Capped well past any observed worst case, then falls
# through and launches anyway so a genuinely offline network can't leave a permanently black
# screen — Chromium's own retry/offline handling takes it from there. Runs before every launch
# attempt, not just the first — systemd's Restart=always calls this whole script again on a
# crash, and if THAT crash was network-related, re-checking before relaunching is correct, not
# wasted work.
for _ in $(seq 1 120); do
  curl -fsS --max-time 2 "$URL" -o /dev/null && break
  sleep 1
done

# Two failure modes seen after an unclean power-off (the Pi pulled during a swap): (a) a stale
# Singleton lock aborts the launch silently, and (b) Chromium launches, sees the dirty profile,
# and EXITS/crashes on the first try. Both cleared before EVERY launch attempt, not just the
# first — the same reasoning as the network wait above.
rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie" 2>/dev/null || true
if [ -f "$PROFILE/Default/Preferences" ]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/g; s/"exit_type":"[^"]*"/"exit_type":"Normal"/g' \
    "$PROFILE/Default/Preferences" 2>/dev/null || true
fi

# `exec`, not a subshell call — systemd tracks THIS process's PID. A script that backgrounds
# Chromium and exits itself would report "active" to systemd while Chromium was actually gone,
# which is the exact "invisible loop" problem this installer exists to replace.
exec chromium \
  --ozone-platform=wayland \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --no-first-run \
  --start-maximized \
  --password-store=basic \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  "$URL"
