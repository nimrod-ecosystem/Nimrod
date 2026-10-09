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
# LOCK THIS SCREEN (2026-10-05; nimrod-lock-helper.py). Where the page reports its lock, and the helper's own path.
# Empty NIMROD_LOCK_HELPER_URL: no report, and this launcher behaves exactly as it did before.
LOCK_HELPER_URL="${NIMROD_LOCK_HELPER_URL:-}"
LOCK_HELPER="${NIMROD_LOCK_HELPER:-$HOME/.local/bin/nimrod-lock-helper.py}"
EXIT_STAY_OUT=75     # = the unit's RestartPreventExitStatus / SuccessExitStatus, and nimrod-lock-helper.py's

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

# The address the page loads: the unit's URL, plus `lockHelper=` when a helper is configured (the page keeps it in
# its own storage after the first load, screen_lock.js `lockHelperFrom`, so a pairing reload that drops it is fine).
# *** ONLY WHEN CHROMIUM HAS BEEN TOLD THE SITE MAY REACH THIS COMPUTER (found on the bench 2026-10-05). *** Without the
# managed policy (install-linux.sh step 6), the page's first report makes Chromium ask "<site> wants to access other
# apps and services on this device - Block / Allow", a box that sits on the screen until somebody answers it: on a
# bedside screen, exactly the state the project's invariant forbids. So: policy present -> `lockHelper=<address>`;
# absent -> `lockHelper=off`, which also makes a page that learned an address earlier forget it (no report, no question).
POLICY_FILE="${NIMROD_LOCK_POLICY_FILE:-/etc/chromium/policies/managed/nimrod-lock-helper.json}"
PAGE="$URL"
if [ -n "$LOCK_HELPER_URL" ]; then
  if [ -f "$POLICY_FILE" ]; then LH="$LOCK_HELPER_URL"; else LH="off"; LOCK_HELPER_URL=""; fi
  case "$PAGE" in *\?*) PAGE="$PAGE&lockHelper=$LH" ;; *) PAGE="$PAGE?lockHelper=$LH" ;; esac
fi
# AFTER A RESTART (row 2.70, 2026-10-09): `boot=1` tells the page this is a restart -- the computer started, or Chromium
# was relaunched after a crash -- so it opens the dashboard chosen under "After a restart, open" (restart.js). The page
# takes the flag out of its address at once, so its own reloads (a new version, a refresh) are not restarts. Every
# launch of this script IS a restart, which is why the flag is added here and nowhere else. NIMROD_KIOSK_BOOT_FLAG=0
# leaves it off (the page then tells a restart by its own tab having started before, which also works).
if [ "${NIMROD_KIOSK_BOOT_FLAG:-1}" = "1" ]; then
  case "$PAGE" in *\?*) PAGE="$PAGE&boot=1" ;; *) PAGE="$PAGE?boot=1" ;; esac
fi

# *** CHROMIUM AS A CHILD, NOT `exec` (2026-10-05). *** Before, this script `exec`ed Chromium so systemd tracked its PID
# directly. Now it waits for Chromium and then decides HOW it exits, which is the one thing systemd reads:
#   - unlocked by a person, and the page said so in the last few minutes (nimrod-lock-helper.py --check stayout):
#     exit 75, which the unit lists in RestartPreventExitStatus, so a Chromium somebody closed on purpose (to watch a
#     film) STAYS closed. Ctrl+Alt+Shift+Return (nimrod-kiosk-back.sh) brings it back, and so does a reboot.
#   - anything else - locked, never locked, no helper, the helper silent, a crash: Chromium's own exit status
#     (non-zero, or 0 for a clean close), and Restart=always relaunches it exactly as it always has.
# systemd still sees the truth: this script is the unit's main process and Chromium is in the unit's cgroup, so a
# `systemctl --user stop` stops both (KillMode=control-group, the default), and the TERM is passed on to Chromium so
# it closes its profile cleanly rather than being killed.
chromium \
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
  "$PAGE" &
CHILD=$!
trap 'kill -TERM "$CHILD" 2>/dev/null || true' TERM INT
set +e
wait "$CHILD"; RC=$?
# A TERM to this script interrupts the first `wait`; wait again so Chromium's own exit is the one recorded.
if kill -0 "$CHILD" 2>/dev/null; then wait "$CHILD"; RC=$?; fi
set -e

if [ -n "$LOCK_HELPER_URL" ] && [ -f "$LOCK_HELPER" ] && python3 "$LOCK_HELPER" --check stayout; then
  echo "nimrod-kiosk: Chromium closed (status $RC) while unlocked by a person: staying out of the way (exit $EXIT_STAY_OUT)."
  exit "$EXIT_STAY_OUT"
fi
echo "nimrod-kiosk: Chromium exited (status $RC); systemd relaunches it."
# Never 75 by accident: a Chromium that itself exits 75 is still relaunched.
if [ "$RC" -eq "$EXIT_STAY_OUT" ]; then exit 1; fi
exit "$RC"
