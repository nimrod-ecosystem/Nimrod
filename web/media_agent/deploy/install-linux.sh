#!/usr/bin/env bash
# Install the Nimrod media agent as an always-on systemd service (Raspberry Pi /
# Linux). It restarts on crash and starts on boot.
#
#   sudo ./install-linux.sh /path/to/media-folder [dashboard-origin]
#
# e.g.  sudo ./install-linux.sh /home/unclemikemic/cici-media https://bedside.nimrodecosystem.com
set -euo pipefail

ROOT="${1:?media folder required:  sudo ./install-linux.sh /path/to/media [origin]}"
ORIGIN="${2:-*}"
PORT="${NIMROD_MEDIA_PORT:-8770}"

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
NIMROD_MEDIA_PORT=$PORT
NIMROD_MEDIA_ORIGIN=$ORIGIN
EOF
  echo "wrote /etc/nimrod/agent.env"
else
  echo "kept existing /etc/nimrod/agent.env (edit it to change the folder/port/origin)"
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

# 3. enable + start
systemctl daemon-reload
systemctl enable --now nimrod-media-agent.service
echo
echo "installed + started as user '$RUN_AS'."
echo "  status:   sudo systemctl status nimrod-media-agent"
echo "  logs:     journalctl -u nimrod-media-agent -f"
echo "  check:    curl http://localhost:$PORT/health"
