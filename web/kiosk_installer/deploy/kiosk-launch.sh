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
# HOW THE PAGE OPENS (2026-11-20, row 2.273; Mike: "I want the pies to not be locked into Nimrod... just use Nimrod like a
# website"). NIMROD_LAUNCH_MODE:
#   kiosk       (default, as before) full screen with no browser around it, supervised by nimrod-kiosk.service, which
#               relaunches it after any exit but a deliberate one.
#   window      an ORDINARY Chromium window, maximised: tabs, address bar, every other website. Run by nimrod-browser.service,
#               which never relaunches it: closed is closed.
#   fullscreen  the same ordinary window started full screen (F11 leaves it). For a screen nobody at it can use a mouse on.
# The network wait, the profile clean-up and the address below are the same in all three, so a window opens on the same
# page, with the same voice, helper and name, as the kiosk did.
MODE="${NIMROD_LAUNCH_MODE:-kiosk}"
case "$MODE" in kiosk|window|fullscreen) ;; *) echo "nimrod-kiosk: NIMROD_LAUNCH_MODE '$MODE' is not kiosk, window or fullscreen" >&2; exit 2 ;; esac
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
# NIMROD_NET_WAIT_S (default 120, the cap described above): how many one-second tries. 0 = do not wait.
for _ in $(seq 1 "${NIMROD_NET_WAIT_S:-120}"); do
  curl -fsS --max-time 2 "$URL" -o /dev/null && break
  sleep 1
done

# Two failure modes seen after an unclean power-off (the Pi pulled during a swap): (a) a stale
# Singleton lock aborts the launch silently, and (b) Chromium launches, sees the dirty profile,
# and EXITS/crashes on the first try. Both cleared before EVERY launch attempt, not just the
# first — the same reasoning as the network wait above.
# *** BUT ONLY A STALE LOCK (2026-11-20). *** With an ordinary browser on this computer, the profile may be held by a
# Chromium somebody opened from the menu. SingletonLock is a link to "<host>-<pid>": a live pid is a real browser, and
# removing its lock would start a second Chromium on the same profile. So: a live holder in kiosk mode means "close the
# browser first" - exit 75, which the kiosk unit does not relaunch (a kiosk launched into a running browser only opens a
# tab there and exits, and Restart=always would open another every 3 seconds). In window mode the running browser simply
# gets a new window for the page, which is what somebody pressing "Nimrod" in the menu expects.
HOLDER="$(readlink "$PROFILE/SingletonLock" 2>/dev/null || true)"
HOLDER_PID="${HOLDER##*-}"
HELD=0
if [ -n "$HOLDER" ] && [ "$HOLDER_PID" != "$HOLDER" ] && kill -0 "$HOLDER_PID" 2>/dev/null; then HELD=1; fi
if [ "$HELD" = "1" ] && [ "$MODE" = "kiosk" ]; then
  echo "nimrod-kiosk: a Chromium window is already open on this profile (pid $HOLDER_PID); close it, then start the kiosk again." >&2
  command -v notify-send >/dev/null 2>&1 && notify-send "Close Chromium first" "Then choose Nimrod full screen again." || true
  exit 75
fi
[ "$HELD" = "1" ] || rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie" 2>/dev/null || true
if [ "$HELD" = "0" ] && [ -f "$PROFILE/Default/Preferences" ]; then
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
# A VOICE FROM THIS COMPUTER (2026-10-14, tts_service.py / local_voice.js). NIMROD_LOCAL_VOICE=on (install-linux.sh
# NIMROD_TTS=1 puts it in the unit) adds `localVoice=on`, which the page keeps in its own storage - for the same reason
# as the lock helper, ONLY when Chromium's local-network policy is there; without it, `localVoice=off`, so no
# "Block / Allow" box is left on the screen. Unset: nothing is added and the page's own setting stands.
if [ -n "${NIMROD_LOCAL_VOICE:-}" ]; then
  if [ "$NIMROD_LOCAL_VOICE" = "on" ] && [ -f "$POLICY_FILE" ]; then LV="on"; else LV="off"; fi
  case "$PAGE" in *\?*) PAGE="$PAGE&localVoice=$LV" ;; *) PAGE="$PAGE?localVoice=$LV" ;; esac
fi
# HOME ASSISTANT (2026-10-25, row 2.125, nimrod-ha-bridge.py). NIMROD_HA_BRIDGE=http://127.0.0.1:8766 in the unit adds
# `haBridge=<that>`, which the page keeps - ONLY when Chromium's local-network policy is there, for the same reason as
# the lock helper (no "Block / Allow" box left on the screen); without it, `haBridge=off`, and the Home controls panel
# sends nothing and says it is not set up. Unset: nothing is added.
if [ -n "${NIMROD_HA_BRIDGE:-}" ]; then
  if [ -f "$POLICY_FILE" ]; then HB="$NIMROD_HA_BRIDGE"; else HB="off"; fi
  case "$PAGE" in *\?*) PAGE="$PAGE&haBridge=$HB" ;; *) PAGE="$PAGE?haBridge=$HB" ;; esac
fi
# THIS DEVICE'S NAME (2026-10-25, device_id.js): NIMROD_DEVICE_NAME="Bench Pi" in the unit adds `deviceName=Bench%20Pi`,
# which the page keeps; a caller then sees "Ring: Only Bench Pi" and can ring this screen alone. Letters, digits, spaces,
# - and _ only (anything else is dropped), spaces sent as %20. Unset: nothing is added and the page keeps its own name.
if [ -n "${NIMROD_DEVICE_NAME:-}" ]; then
  DN=$(printf '%s' "$NIMROD_DEVICE_NAME" | tr -cd 'A-Za-z0-9 _-' | cut -c1-40 | sed 's/ /%20/g')
  if [ -n "$DN" ]; then
    case "$PAGE" in *\?*) PAGE="$PAGE&deviceName=$DN" ;; *) PAGE="$PAGE?deviceName=$DN" ;; esac
  fi
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
# *** AN ORDINARY WINDOW (window / fullscreen, 2026-11-20). *** `exec`, because nothing here decides anything after it:
# nimrod-browser.service never relaunches, so closing the window is the end of it. Two kiosk switches are left out on
# purpose, because on an ordinary browser they would reach EVERY website, not just this one:
#   --use-fake-ui-for-media-stream  gives any site the camera and microphone with no question asked;
#   --autoplay-policy=...           lets any site play sound before a press.
# The site's own share of both comes from a browser policy that names only this site (install-linux.sh step 6b,
# NIMROD_SITE_POLICY=1: nimrod-site.json). Without that policy the window would ask "Allow camera?" on the first call and
# wait for a press, so until it exists the autoplay switch is passed (sound is what a screen without it loses at once)
# and the camera is asked for once; Chromium remembers the answer for this site.
SITE_POLICY="${NIMROD_SITE_POLICY_FILE:-/etc/chromium/policies/managed/nimrod-site.json}"
if [ "$MODE" != "kiosk" ]; then
  WIN_FLAGS=(--ozone-platform=wayland --no-first-run --start-maximized --password-store=basic --disable-session-crashed-bubble)
  [ "$MODE" = "fullscreen" ] && WIN_FLAGS+=(--start-fullscreen)
  if [ ! -f "$SITE_POLICY" ]; then
    echo "nimrod-browser: no $SITE_POLICY; sound may play before a press on any site (install-linux.sh NIMROD_SITE_POLICY=1 narrows it to this one)."
    WIN_FLAGS+=(--autoplay-policy=no-user-gesture-required)
  fi
  echo "nimrod-browser: opening $MODE window (Chromium already open: $([ "$HELD" = "1" ] && echo yes || echo no))."
  exec chromium "${WIN_FLAGS[@]}" "$PAGE"
fi

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
