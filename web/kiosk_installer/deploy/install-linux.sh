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

# 1. the launch script, in the same $HOME every other Nimrod piece on this Pi already lives
#    under — nothing installed system-wide, nothing needing sudo.
mkdir -p "$BIN_DIR"
cp "$LAUNCH_SRC" "$LAUNCH_DST"
chmod +x "$LAUNCH_DST"
cp "$PAUSE_SRC" "$PAUSE_DST"
chmod +x "$PAUSE_DST"

# 2. the unit, with the real URL and the real script path filled in.
mkdir -p "$UNIT_DIR"
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

[Install]
WantedBy=graphical-session.target
EOF

systemctl --user daemon-reload
systemctl --user enable nimrod-kiosk.service

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
if [ -f "$RC_XML" ] && grep -q "key=\"$PAUSE_KEY\"" "$RC_XML"; then
  echo "labwc keybind for $PAUSE_KEY already present in $RC_XML — leaving it alone."
elif [ -f "$RC_XML" ]; then
  cp "$RC_XML" "$RC_XML.bak.$(date +%Y%m%d%H%M%S)"
  KEYBIND_XML="    <keybind key=\"$PAUSE_KEY\"><action name=\"Execute\" command=\"$PAUSE_DST\" /></keybind>"
  if grep -q "</keyboard>" "$RC_XML"; then
    # A <keyboard> section already exists — add our keybind as one more row in it.
    sed -i "s#</keyboard>#$KEYBIND_XML\n  </keyboard>#" "$RC_XML"
  elif grep -q "</labwc_config>" "$RC_XML"; then
    # No <keyboard> section yet, but the file is a real labwc config — add a whole new one,
    # including <default /> so this addition does not silently drop labwc's own built-in
    # keybinds for whoever edits this file next.
    sed -i "s#</labwc_config>#  <keyboard>\n    <default />\n$KEYBIND_XML\n  </keyboard>\n</labwc_config>#" "$RC_XML"
  else
    echo "WARNING: $RC_XML exists but does not look like a labwc config (no </labwc_config>)." >&2
    echo "  Not touched — add this by hand instead:" >&2
    echo "  <keybind key=\"$PAUSE_KEY\"><action name=\"Execute\" command=\"$PAUSE_DST\" /></keybind>" >&2
  fi
else
  cat > "$RC_XML" <<EOF
<?xml version="1.0"?>
<labwc_config>
  <keyboard>
    <default />
    <keybind key="$PAUSE_KEY"><action name="Execute" command="$PAUSE_DST" /></keybind>
  </keyboard>
</labwc_config>
EOF
fi

# labwc reloads rc.xml on SIGHUP (`labwc --reconfigure`) — so the keybind works the moment
# this installer finishes, not only after the next reboot. Best-effort: if labwc is not
# actually running yet (installer run before first login, say), this is a harmless no-op and
# the keybind still takes effect normally the next time labwc itself starts.
command -v labwc >/dev/null 2>&1 && labwc --reconfigure 2>/dev/null || true

echo
echo "installed. kiosk will launch $URL via systemd --user on next boot."
echo "  start it now:  systemctl --user start nimrod-kiosk"
echo "  status:        systemctl --user status nimrod-kiosk"
echo "  logs:          journalctl --user -u nimrod-kiosk -f"
echo "  previous autostart backed up alongside $AUTOSTART"
echo "  press Ctrl+Alt+Shift+Esc to STOP the kiosk and reach the desktop for maintenance"
echo "  (it will not come back on its own — start it again with: systemctl --user start nimrod-kiosk)"
