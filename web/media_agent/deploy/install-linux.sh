#!/usr/bin/env bash
# Install the Nimrod media agent as an always-on systemd service (Raspberry Pi /
# Linux). It restarts on crash and starts on boot.
#
#   sudo ./install-linux.sh /path/to/media-folder [dashboard-origin]
#
# e.g.  sudo ./install-linux.sh /home/pi/nimrod-media https://bedside.nimrodecosystem.com
#
# BIND ADDRESS — safe by default. The service listens on 127.0.0.1 only, because
# the usual setup is the agent running ON the kiosk machine, which reaches it at
# http://localhost:8770. That keeps your photos off the local network entirely:
# the agent has NO authentication, and CORS is a browser policy that does nothing
# against curl. On a shared/public wifi an all-interfaces bind means anyone on
# that network can list and download every file you are serving.
# Serving a NAS/desktop to a DIFFERENT device? Then you need a reachable address:
#
#   sudo NIMROD_MEDIA_HOST=0.0.0.0 ./install-linux.sh /path/to/media https://your.site
#
# Prefer binding a private/tailnet address over 0.0.0.0 where you can.
set -euo pipefail

ROOT="${1:?media folder required:  sudo ./install-linux.sh /path/to/media [origin]}"
ORIGIN="${2:-*}"
PORT="${NIMROD_MEDIA_PORT:-8770}"
HOST="${NIMROD_MEDIA_HOST:-127.0.0.1}"

AGENT="$(cd "$(dirname "$0")/.." && pwd)/agent.py"
PY="$(command -v python3)"
RUN_AS="${SUDO_USER:-$USER}"

[ -d "$ROOT" ] || { echo "not a folder: $ROOT" >&2; exit 1; }
[ -f "$AGENT" ] || { echo "agent.py not found next to this script: $AGENT" >&2; exit 1; }

# 1. config (values with spaces are fine — the agent reads them from the environment)
mkdir -p /etc/nimrod
if [ ! -f /etc/nimrod/agent.env ]; then
  cat > /etc/nimrod/agent.env <<EOF
NIMROD_MEDIA_ROOT=$ROOT
NIMROD_MEDIA_HOST=$HOST
NIMROD_MEDIA_PORT=$PORT
NIMROD_MEDIA_ORIGIN=$ORIGIN
EOF
  echo "wrote /etc/nimrod/agent.env"
else
  echo "kept existing /etc/nimrod/agent.env (edit it to change the folder/host/port/origin)"
fi

# 2. the unit, with concrete python + agent + user
cat > /etc/systemd/system/nimrod-media-agent.service <<EOF
[Unit]
Description=Nimrod local media agent — serves your photos/videos to your dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/nimrod/agent.env
ExecStart=$PY $AGENT
Restart=always
RestartSec=3
User=$RUN_AS

[Install]
WantedBy=multi-user.target
EOF

# 3. enable + (re)start
# NOTE: `enable --now` only STARTS a stopped service — re-running this installer
# against an already-running agent would leave it on its old environment, so a
# changed folder/host/port/origin silently would not take effect. Restart always.
systemctl daemon-reload
systemctl enable nimrod-media-agent.service
systemctl restart nimrod-media-agent.service
echo
echo "installed + started as user '$RUN_AS', listening on $HOST:$PORT."
echo "  status:   sudo systemctl status nimrod-media-agent"
echo "  logs:     journalctl -u nimrod-media-agent -f"
echo "  check:    curl http://localhost:$PORT/health"
