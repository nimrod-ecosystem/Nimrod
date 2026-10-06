#!/usr/bin/env bash
# Install the Nimrod kiosk as a real, supervised systemd --user service (Raspberry Pi /
# Linux + labwc/Wayland). Replaces an unsupervised `while true` shell loop in
# ~/.config/labwc/autostart with a unit `systemctl --user status nimrod-kiosk` can actually
# answer questions about — is it running, how many times has it restarted, what did it print.
#
#   ./install-linux.sh https://nimrodecosystem.com/kiosk.html
#
# No sudo needed — this is a per-user unit, because (unlike the media agent) it needs the
# graphical session: Wayland compositor already up, WAYLAND_DISPLAY and XDG_RUNTIME_DIR already
# set. Run it as the user who is actually logged into the graphical session.
#
# WHAT THIS DOES NOT DO: get the Pi TO a logged-in graphical session at boot in the first
# place. That part (console autologin, labwc launching) already works on this machine and this
# script does not touch it — only what happens to Chromium ONCE labwc's autostart runs.
set -euo pipefail

URL="${1:?dashboard URL required:  ./install-linux.sh https://nimrodecosystem.com/kiosk.html}"

HERE="$(cd "$(dirname "$0")" && pwd)"
LAUNCH_SRC="$HERE/kiosk-launch.sh"
[ -f "$LAUNCH_SRC" ] || { echo "kiosk-launch.sh not found next to this script: $LAUNCH_SRC" >&2; exit 1; }

PAUSE_SRC="$HERE/nimrod-kiosk-pause.sh"
[ -f "$PAUSE_SRC" ] || { echo "nimrod-kiosk-pause.sh not found next to this script: $PAUSE_SRC" >&2; exit 1; }

BIN_DIR="$HOME/.local/bin"
LAUNCH_DST="$BIN_DIR/nimrod-kiosk-launch.sh"
PAUSE_DST="$BIN_DIR/nimrod-kiosk-pause.sh"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/nimrod-kiosk.service"
AUTOSTART="$HOME/.config/labwc/autostart"
RC_XML="$HOME/.config/labwc/rc.xml"
# Four keys, deliberately — see nimrod-kiosk-pause.sh's own header for why this is a
# DELIBERATE escape rather than a change to the crash-restart policy, and why it needs to be
# a combo nobody brushes against a keyboard by accident.
PAUSE_KEY="C-A-S-Escape"

# LOCK THIS SCREEN (2026-10-05; nimrod-lock-helper.py's header has the whole story). On by default; NIMROD_LOCK=0
# installs the kiosk exactly as before this existed (no helper, no report, no new keys).
#   Ctrl+Alt+Shift+Return  bring the dashboard back (nimrod-kiosk-back.sh) - the one key that stays while locked
#   Ctrl+Alt+Shift+T       a separate, ordinary browser window for a film (nimrod-tv.sh) - refused while locked
# Both four keys long, for the pause chord's reason: nothing a brushed keyboard presses.
LOCK="${NIMROD_LOCK:-1}"
LOCK_PORT="${NIMROD_LOCK_PORT:-8765}"
LOCK_URL="http://127.0.0.1:$LOCK_PORT/screen-lock"
BACK_KEY="C-A-S-Return"
TV_KEY="C-A-S-t"
HELPER_DST="$BIN_DIR/nimrod-lock-helper.py"
BACK_DST="$BIN_DIR/nimrod-kiosk-back.sh"
TV_DST="$BIN_DIR/nimrod-tv.sh"
HELPER_UNIT="$UNIT_DIR/nimrod-lock-helper.service"
if [ "$LOCK" = "1" ]; then
  for f in nimrod-lock-helper.py nimrod-kiosk-back.sh nimrod-tv.sh; do
    [ -f "$HERE/$f" ] || { echo "$f not found next to this script: $HERE/$f" >&2; exit 1; }
  done
fi

# 1. the launch script, in the same $HOME every other Nimrod piece on this Pi already lives
#    under — nothing installed system-wide, nothing needing sudo.
mkdir -p "$BIN_DIR"
cp "$LAUNCH_SRC" "$LAUNCH_DST"
chmod +x "$LAUNCH_DST"
cp "$PAUSE_SRC" "$PAUSE_DST"
chmod +x "$PAUSE_DST"
if [ "$LOCK" = "1" ]; then
  cp "$HERE/nimrod-lock-helper.py" "$HELPER_DST"
  cp "$HERE/nimrod-kiosk-back.sh" "$BACK_DST"
  cp "$HERE/nimrod-tv.sh" "$TV_DST"
  chmod +x "$HELPER_DST" "$BACK_DST" "$TV_DST"
fi

# 2. the unit, with the real URL and the real script path filled in.
#    (2026-10-05) With the lock: the page reports to the helper, and exit 75 - "closed on purpose by somebody who
#    unlocked the screen" (kiosk-launch.sh) - is neither relaunched nor counted as a failure. Every other exit, a
#    clean close included, is relaunched exactly as before.
mkdir -p "$UNIT_DIR"
if [ "$LOCK" = "1" ]; then
  LOCK_UNIT_LINES="Environment=NIMROD_LOCK_HELPER_URL=$LOCK_URL
RestartPreventExitStatus=75
SuccessExitStatus=75"
else
  LOCK_UNIT_LINES=""
fi
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Nimrod kiosk — the dashboard, always on screen
After=graphical-session.target

[Service]
Type=simple
Environment=NIMROD_KIOSK_URL=$URL
ExecStart=$LAUNCH_DST
Restart=always
RestartSec=3
$LOCK_UNIT_LINES

[Install]
WantedBy=graphical-session.target
EOF

# 2b. (2026-10-05) the lock helper's own unit: 127.0.0.1 only, the site's origin only (nimrod-lock-helper.py).
if [ "$LOCK" = "1" ]; then
  cat > "$HELPER_UNIT" <<EOF
[Unit]
Description=Nimrod lock helper — hears "Lock this screen" from the kiosk page (127.0.0.1 only)

[Service]
Type=simple
Environment=NIMROD_KIOSK_URL=$URL
Environment=NIMROD_LOCK_PORT=$LOCK_PORT
Environment=NIMROD_LOCK_RC_SWAP=${NIMROD_LOCK_RC_SWAP:-1}
ExecStart=/usr/bin/python3 $HELPER_DST
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
fi

systemctl --user daemon-reload
systemctl --user enable nimrod-kiosk.service
if [ "$LOCK" = "1" ]; then
  systemctl --user enable nimrod-lock-helper.service
fi

# 3. hand off from labwc's autostart to systemd, instead of running Chromium in a loop labwc
#    itself supervises. THE SELF-HEAL LOGIC MOVED INTO kiosk-launch.sh, NOT DELETED — same
#    profile cleanup, same network wait, now run by kiosk-launch.sh on every systemd restart
#    instead of by autostart's own loop.
#
#    A TIMESTAMPED BACKUP, EVERY RUN, NOT JUST THE FIRST — re-running this installer (a new
#    URL, say) must not silently discard whatever was in autostart a second time with no way
#    back. Follows the same convention this Pi's own autostart already documents for the prior
#    build (`autostart.old-cici-build.bak`).
if [ -f "$AUTOSTART" ]; then
  cp "$AUTOSTART" "$AUTOSTART.bak.$(date +%Y%m%d%H%M%S)"
fi
mkdir -p "$(dirname "$AUTOSTART")"
cat > "$AUTOSTART" <<EOF
# Nimrod kiosk autostart — installed by kiosk_installer/deploy/install-linux.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Chromium itself is no longer launched here. This just makes sure the supervised systemd
# --user service is running, then gets out of the way — the network wait, the profile
# self-heal and the actual Chromium launch all live in nimrod-kiosk-launch.sh now, where
# systemd's Restart=always re-runs them on every crash, not only at boot.
#
# Check it:   systemctl --user status nimrod-kiosk
# Logs:       journalctl --user -u nimrod-kiosk -f
# Re-run this installer to change the URL; it keeps a timestamped backup of this file each time.
systemctl --user daemon-reload
systemctl --user start nimrod-kiosk.service
EOF

# 4. THE DELIBERATE WAY OUT — found missing 2026-09-19 (Mike, at the real hardware: Alt+F4
#    relaunched before he could do anything, "the device is effectively bricked for any other
#    uses"). $PAUSE_KEY runs nimrod-kiosk-pause.sh, which STOPS the service (never
#    re-triggered by Restart=, whatever the policy) rather than loosening the crash-restart
#    guarantee itself — see that script's own header for why weakening Restart= instead would
#    trade one failure for a worse one.
#
#    NEVER OVERWRITE AN EXISTING rc.xml BLIND — same backup discipline as autostart above, and
#    for the same reason: somebody's own labwc customizations living in this file must survive
#    an installer that only meant to add one keybind. Idempotent: re-running this installer
#    checks for the exact keybind already being present before touching anything.
mkdir -p "$(dirname "$RC_XML")"
RC_OPEN="$(dirname "$RC_XML")/rc.open.xml"
RC_LOCKED="$(dirname "$RC_XML")/rc.locked.xml"
# (2026-10-05) If the screen happens to be LOCKED while this runs, rc.xml is the helper's locked copy (no way out):
# put the open copy back first, so the keybinds below are added to the real one.
if [ -f "$RC_OPEN" ] && [ -f "$RC_LOCKED" ] && [ -f "$RC_XML" ] && cmp -s "$RC_XML" "$RC_LOCKED"; then
  cp "$RC_OPEN" "$RC_XML"
fi
RC_BACKED_UP=0
add_keybind() {     # add_keybind KEY COMMAND — idempotent: an existing binding of KEY is left alone.
  local key="$1" cmd="$2"
  local xml="    <keybind key=\"$key\"><action name=\"Execute\" command=\"$cmd\" /></keybind>"
  if [ -f "$RC_XML" ] && grep -q "key=\"$key\"" "$RC_XML"; then
    echo "labwc keybind for $key already present in $RC_XML — leaving it alone."
  elif [ -f "$RC_XML" ]; then
    if [ "$RC_BACKED_UP" = "0" ]; then cp "$RC_XML" "$RC_XML.bak.$(date +%Y%m%d%H%M%S)"; RC_BACKED_UP=1; fi
    if grep -q "</keyboard>" "$RC_XML"; then
      # A <keyboard> section already exists — add our keybind as one more row in it.
      sed -i "s#</keyboard>#$xml\n  </keyboard>#" "$RC_XML"
    elif grep -q "</labwc_config>" "$RC_XML"; then
      # No <keyboard> section yet, but the file is a real labwc config — add a whole new one,
      # including <default /> so this addition does not silently drop labwc's own built-in
      # keybinds for whoever edits this file next.
      sed -i "s#</labwc_config>#  <keyboard>\n    <default />\n$xml\n  </keyboard>\n</labwc_config>#" "$RC_XML"
    else
      echo "WARNING: $RC_XML exists but does not look like a labwc config (no </labwc_config>)." >&2
      echo "  Not touched — add this by hand instead:" >&2
      echo "  <keybind key=\"$key\"><action name=\"Execute\" command=\"$cmd\" /></keybind>" >&2
    fi
  else
    cat > "$RC_XML" <<EOF
<?xml version="1.0"?>
<labwc_config>
  <keyboard>
    <default />
$xml
  </keyboard>
</labwc_config>
EOF
  fi
}
add_keybind "$PAUSE_KEY" "$PAUSE_DST"
if [ "$LOCK" = "1" ]; then
  add_keybind "$BACK_KEY" "$BACK_DST"
  add_keybind "$TV_KEY" "$TV_DST"
  # The OPEN copy the helper swaps back to (and from which it makes the locked one). Only from an rc.xml that
  # parses: a broken one is never copied, and then the keys simply do not follow the lock.
  if python3 -c 'import sys, xml.etree.ElementTree as E; E.parse(sys.argv[1])' "$RC_XML" 2>/dev/null; then
    cp "$RC_XML" "$RC_OPEN"
  else
    echo "WARNING: $RC_XML does not parse as XML; the locked keyboard swap is left off." >&2
  fi
fi

# labwc reloads rc.xml on SIGHUP — so the keybind works the moment this installer finishes, not
# only after the next reboot. (`labwc --reconfigure` needs $LABWC_PID, which an ssh session does
# not have, so signal it directly.) Best-effort: if labwc is not running yet, this is a harmless
# no-op and the keybind still takes effect the next time labwc itself starts.
pkill -HUP -U "$(id -u)" -x labwc 2>/dev/null || true

# 5. (2026-10-05) the helper, now that its open copy of the keys exists.
if [ "$LOCK" = "1" ]; then
  systemctl --user restart nimrod-lock-helper.service || true
fi

# 6. (2026-10-05) CHROMIUM'S LOCAL NETWORK ACCESS. Chromium asks before a website (the kiosk's) talks to this computer
#    (the helper on 127.0.0.1) - a "Block / Allow" box, seen on the bench 2026-10-05, that stays on the screen until
#    somebody answers it. A managed policy allows exactly the kiosk's site and nothing else. It is a system-wide
#    browser policy (sudo), so it is NOT written unless asked: NIMROD_LOCK_POLICY=1. Without it the launcher tells the
#    page `lockHelper=off` (no report, so no box), and everything behaves as before: Chromium is relaunched, the chords
#    work - the lock simply does not reach the computer.
SITE_ORIGIN="$(python3 -c 'import sys; from urllib.parse import urlsplit as u; x=u(sys.argv[1]); print(f"{x.scheme}://{x.netloc}")' "$URL")"
POLICY_FILE="/etc/chromium/policies/managed/nimrod-lock-helper.json"
POLICY_JSON="{ \"LocalNetworkAccessAllowedForUrls\": [\"$SITE_ORIGIN\"] }"
if [ "$LOCK" = "1" ] && [ "${NIMROD_LOCK_POLICY:-0}" = "1" ]; then
  sudo mkdir -p "$(dirname "$POLICY_FILE")"
  echo "$POLICY_JSON" | sudo tee "$POLICY_FILE" >/dev/null
  echo "wrote $POLICY_FILE (allows $SITE_ORIGIN to reach this computer's helper); restart the kiosk to apply"
fi

echo
echo "installed. kiosk will launch $URL via systemd --user on next boot."
echo "  start it now:  systemctl --user start nimrod-kiosk"
echo "  status:        systemctl --user status nimrod-kiosk"
echo "  logs:          journalctl --user -u nimrod-kiosk -f"
echo "  previous autostart backed up alongside $AUTOSTART"
echo "  press Ctrl+Alt+Shift+Esc to STOP the kiosk and reach the desktop for maintenance"
echo "  (it will not come back on its own — start it again with: systemctl --user start nimrod-kiosk)"
if [ "$LOCK" = "1" ]; then
  echo "  lock: helper on $LOCK_URL (systemctl --user status nimrod-lock-helper); state: python3 $HELPER_DST --state"
  echo "  press Ctrl+Alt+Shift+Return to bring the dashboard back; Ctrl+Alt+Shift+T for a TV window (not while locked)"
  if [ "${NIMROD_LOCK_POLICY:-0}" != "1" ]; then
    echo "  NOT written (system-wide, asks first): the Chromium policy letting $SITE_ORIGIN reach the helper:"
    echo "    re-run with NIMROD_LOCK_POLICY=1, or write $POLICY_FILE containing: $POLICY_JSON"
  fi
fi
