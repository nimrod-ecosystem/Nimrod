#!/usr/bin/env bash
# Install the Nimrod media agent as an always-on systemd service (Raspberry Pi /
# Linux). It restarts on crash and starts on boot.
#
#   sudo ./install-linux.sh /path/to/media-folder [site[,site...]]
#
# e.g.  sudo ./install-linux.sh /home/pi/nimrod-media
#
# WHICH SITES' PAGES MAY USE IT (2026-10-07). Leave the second argument off and the
# agent allows its own default, the same sites the Nimrod helper allows: the site
# (https://nimrodecosystem.com) and the older address that serves the same site
# (agent.py DEFAULT_SITES). Pages on this computer itself are always allowed. Give
# sites only for a Nimrod served somewhere else. This used to default to '*' -
# any website you visit could list and read the folder. '*' still works if you
# type it, and the agent prints a warning every start when it is set.
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
#
# HISTORY TO THE NIMROD FOLDER (agent history, 2026-10-08) - optional, off unless given.
# Give the Data folder of the Nimrod folder and the agent appends history there
# itself, so the screen needs no browser folder permission (which a restart can
# take away):
#
#   sudo NIMROD_MEDIA_DATA=/media/you/drive/Nimrod/Data ./install-linux.sh /path/to/media
#
# Only pages on this computer can write, only by appending, and only inside that
# folder's History folder (agent.py, "AGENT HISTORY"). The folder may be on a
# drive that is not plugged in yet: the agent never creates it, history waits on
# the screen until it is there. An agent.env from an earlier install is kept; the
# line is added to it only when it has none (a different one already there is
# kept, and said).
set -euo pipefail

ROOT="${1:?media folder required:  sudo ./install-linux.sh /path/to/media [site]}"
# Empty: the agent's own default (above), so its list is kept in one place (agent.py,
# checked against the helper's by test_agent.py) rather than copied here as well.
ORIGIN="${2:-}"
PORT="${NIMROD_MEDIA_PORT:-8770}"
HOST="${NIMROD_MEDIA_HOST:-127.0.0.1}"
DATA="${NIMROD_MEDIA_DATA:-}"     # agent history: empty = off

AGENT="$(cd "$(dirname "$0")/.." && pwd)/agent.py"
PY="$(command -v python3)"
RUN_AS="${SUDO_USER:-$USER}"

[ -d "$ROOT" ] || { echo "not a folder: $ROOT" >&2; exit 1; }
[ -f "$AGENT" ] || { echo "agent.py not found next to this script: $AGENT" >&2; exit 1; }

# 1. config (values with spaces are fine — the agent reads them from the environment)
mkdir -p /etc/nimrod
if [ -n "$ORIGIN" ]; then
  ORIGIN_LINE="NIMROD_MEDIA_ORIGIN=$ORIGIN"
else
  ORIGIN_LINE="# NIMROD_MEDIA_ORIGIN=   (unset: the agent's default sites - see install-linux.sh)"
fi
if [ ! -f /etc/nimrod/agent.env ]; then
  cat > /etc/nimrod/agent.env <<EOF
NIMROD_MEDIA_ROOT=$ROOT
NIMROD_MEDIA_HOST=$HOST
NIMROD_MEDIA_PORT=$PORT
$ORIGIN_LINE
EOF
  if [ -n "$DATA" ]; then
    echo "NIMROD_MEDIA_DATA=$DATA" >> /etc/nimrod/agent.env    # agent history
  fi
  echo "wrote /etc/nimrod/agent.env"
else
  echo "kept existing /etc/nimrod/agent.env (edit it to change the folder/host/port/origin)"
  # An older install wrote '*' there by default. Kept (it is the person's file), but said.
  if grep -qE '^NIMROD_MEDIA_ORIGIN=\*' /etc/nimrod/agent.env; then
    echo "  NOTE: it allows ANY website (NIMROD_MEDIA_ORIGIN=*), the old default. To allow only"
    echo "        your Nimrod, delete that line from /etc/nimrod/agent.env and run this again."
  fi
  # agent history: the one line added to a kept file, and only when it has none.
  if [ -n "$DATA" ]; then
    HAVE="$(grep -E '^NIMROD_MEDIA_DATA=' /etc/nimrod/agent.env | tail -n 1 | cut -d= -f2- || true)"
    if [ -z "$HAVE" ] && ! grep -qE '^NIMROD_MEDIA_DATA=' /etc/nimrod/agent.env; then
      # a file that does not end in a newline would otherwise run the new line onto its last one
      [ -n "$(tail -c 1 /etc/nimrod/agent.env)" ] && echo >> /etc/nimrod/agent.env
      echo "NIMROD_MEDIA_DATA=$DATA" >> /etc/nimrod/agent.env
      echo "  added NIMROD_MEDIA_DATA=$DATA (history to the Nimrod folder)"
    elif [ "$HAVE" != "$DATA" ]; then
      echo "  NOTE: kept NIMROD_MEDIA_DATA=$HAVE already in /etc/nimrod/agent.env (not $DATA)."
      echo "        To change it, edit that line and run: sudo systemctl restart nimrod-media-agent"
    fi
  fi
fi
if [ -n "$DATA" ]; then
  if [ ! -d "$DATA" ]; then
    echo "  NOTE: $DATA is not there right now (a drive not plugged in?). History waits on the screen"
    echo "        until it is; the agent never creates it."
  elif ! sudo -u "$RUN_AS" test -w "$DATA"; then
    echo "  NOTE: '$RUN_AS' cannot write to $DATA, so history cannot be kept there yet."
  fi
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
if [ -n "$DATA" ] || grep -qE '^NIMROD_MEDIA_DATA=.' /etc/nimrod/agent.env; then
  echo "  history:  curl http://localhost:$PORT/history/status"
fi
