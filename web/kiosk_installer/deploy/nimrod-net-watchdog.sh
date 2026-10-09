#!/bin/bash
# nimrod-net-watchdog.sh - notice when a kiosk Pi drops off the network, write down why, and reconnect.
#
# WHY (Mike, 2026-10-08): the unit in the care room was offline from Tailscale for five days and nobody could see
# why: the Pi kept its log in memory only, and nothing tried to reconnect. Tailscale and NetworkManager both
# reconnect by themselves when the network comes back; this covers the cases they don't (a Wi-Fi link that is up
# but passes nothing, a Tailscale that stays down after the network returns) and leaves a trail in the journal
# (`journalctl -t nimrod-net`), which nimrod-journal-persistent.conf keeps across power cuts.
#
# Run every minute by nimrod-net-watchdog.timer. It only ever reconnects Wi-Fi or restarts tailscaled, with a wait
# between tries; it never reboots, never changes saved networks, and never answers a guest network's sign-in
# page (that is a person's to accept) - it only says one is in the way.
#
# Settings (environment, from the unit or /etc/nimrod/net-watchdog.env):
#   NIMROD_NET_CHECK_URL   what "online" means (default the site's version page)
#   NIMROD_NET_FAILS       checks in a row before acting (default 3 = about three minutes)
#   NIMROD_NET_WAIT_S      least time between two tries (default 600 = ten minutes)
set -u
CHECK_URL="${NIMROD_NET_CHECK_URL:-https://nimrodecosystem.com/api/version}"
FAILS_BEFORE="${NIMROD_NET_FAILS:-3}"
WAIT_S="${NIMROD_NET_WAIT_S:-600}"
STATE=/run/nimrod-net-watchdog
mkdir -p "$STATE"

log() { logger -t nimrod-net "$*"; }
now=$(date +%s)
get() { cat "$STATE/$1" 2>/dev/null || echo "$2"; }
put() { echo "$2" > "$STATE/$1"; }

# --- what the network looks like right now
wifi=$(nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev 2>/dev/null | awk -F: '$2=="wifi"{print $3":"$4; exit}')
gw=$(ip route 2>/dev/null | awk '/^default/{print $3; exit}')
gw_ok=no; [ -n "$gw" ] && ping -c1 -W2 "$gw" >/dev/null 2>&1 && gw_ok=yes
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$CHECK_URL" 2>/dev/null); [ -z "$code" ] && code=000
net_ok=no; [ "$code" = "200" ] && net_ok=yes
portal=no
if [ "$net_ok" = no ] && [ "$gw_ok" = yes ]; then
  # A guest network that wants its sign-in page answered gives a page (or a redirect) instead of an empty 204.
  pc=$(curl -s -m 8 -o /dev/null -w '%{http_code}' http://connectivitycheck.gstatic.com/generate_204 2>/dev/null)
  case "$pc" in 200|301|302|303|307|308) portal=yes ;; esac
fi
ts_ok=no
tailscale status --peers=false >/dev/null 2>&1 && ts_ok=yes

state="net=$net_ok($code) gw=$gw_ok wifi=${wifi:-none} tailscale=$ts_ok portal=$portal"

# --- one line when anything changes, and one an hour while all is well (so a power cut's time shows in the log)
last=$(get last_state "")
beat=$(get last_beat 0)
if [ "$state" != "$last" ]; then log "changed: $state"; put last_state "$state"; put last_beat "$now"
elif [ $((now - beat)) -ge 3600 ]; then log "still: $state"; put last_beat "$now"; fi

# --- the internet side
if [ "$net_ok" = yes ]; then
  put net_fails 0
else
  n=$(( $(get net_fails 0) + 1 )); put net_fails "$n"
  if [ "$portal" = yes ]; then
    [ "$n" -eq "$FAILS_BEFORE" ] && log "a sign-in page on the guest network is in the way; it needs a person to accept it"
  elif [ "$n" -ge "$FAILS_BEFORE" ] && [ $((now - $(get net_tried 0))) -ge "$WAIT_S" ]; then
    put net_tried "$now"
    conn=$(nmcli -t -f NAME,TYPE con show --active 2>/dev/null | awk -F: '$2=="802-11-wireless"{print $1; exit}')
    if [ -n "$conn" ]; then
      log "offline for $n checks: reconnecting Wi-Fi '$conn'"
      nmcli con down "$conn" >/dev/null 2>&1; sleep 3; nmcli con up "$conn" >/dev/null 2>&1 \
        && log "Wi-Fi '$conn' back up" || log "Wi-Fi '$conn' did not come back; turning Wi-Fi off and on"
    fi
    if [ -z "$conn" ] || ! nmcli -t -f STATE general 2>/dev/null | grep -q '^connected'; then
      nmcli radio wifi off >/dev/null 2>&1; sleep 5; nmcli radio wifi on >/dev/null 2>&1
      log "Wi-Fi turned off and on; NetworkManager picks a saved network"
    fi
  fi
fi

# --- Tailscale: only worth touching when the internet itself works
if [ "$net_ok" = yes ] && [ "$ts_ok" = no ]; then
  t=$(( $(get ts_fails 0) + 1 )); put ts_fails "$t"
  if [ "$t" -ge "$FAILS_BEFORE" ] && [ $((now - $(get ts_tried 0))) -ge "$WAIT_S" ]; then
    put ts_tried "$now"
    log "online but Tailscale down for $t checks: restarting tailscaled"
    systemctl restart tailscaled && log "tailscaled restarted" || log "tailscaled restart failed"
  fi
else
  put ts_fails 0
fi
exit 0
