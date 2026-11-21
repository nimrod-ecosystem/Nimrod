#!/usr/bin/env bash
# nimrod-site-policy.sh — THE SITE'S OWN SOUND, CAMERA AND START PAGE IN AN ORDINARY CHROMIUM WINDOW (2026-11-20, row 2.273).
#
#   sudo-capable user:  ./nimrod-site-policy.sh https://nimrodecosystem.com/kiosk.html
#
# Two Chromium policy files, naming ONLY the dashboard's site (kiosk-launch.sh says why the kiosk's launch switches are
# not used in a window: they would reach every website):
#   /etc/chromium/policies/managed/nimrod-site.json       AutoplayAllowlist, VideoCaptureAllowedUrls, AudioCaptureAllowedUrls.
#                                                         Managed: a camera question nobody can answer is the box CLAUDE.md
#                                                         forbids on a screen whose person cannot press anything.
#   /etc/chromium/policies/recommended/nimrod-start.json  start page and home button. RECOMMENDED: the person can still change
#                                                         their start page in Chromium's settings.
# Refuses an empty or odd address rather than writing "://" (Chromium ignores a bad value SILENTLY, and the camera question
# would come back with nothing saying why). If the address redirects to another host, both hosts are named.
# Undo: delete the two files. Used by install-linux.sh step 6b and by hand.
set -euo pipefail
URL="${1:-}"
case "$URL" in https://?*|http://?*) ;; *) echo "nimrod-site-policy: give the dashboard address (https://...), got '$URL'" >&2; exit 2 ;; esac
origin() { python3 -c 'import sys; from urllib.parse import urlsplit as u; x=u(sys.argv[1]); print(f"{x.scheme}://{x.netloc}" if x.scheme and x.netloc else "")' "$1"; }
O1="$(origin "$URL")"
[ -n "$O1" ] || { echo "nimrod-site-policy: no site in '$URL'" >&2; exit 2; }
FINAL="$(curl -fsSL -o /dev/null -w '%{url_effective}' --max-time 10 "$URL" 2>/dev/null || true)"
O2="$(origin "${FINAL:-$URL}")"
LIST="\"$O1\""
[ -n "$O2" ] && [ "$O2" != "$O1" ] && LIST="$LIST, \"$O2\"" && echo "note: $URL ends at $O2; both are named"
sudo mkdir -p /etc/chromium/policies/managed /etc/chromium/policies/recommended
printf '{ "AutoplayAllowlist": [%s], "VideoCaptureAllowedUrls": [%s], "AudioCaptureAllowedUrls": [%s] }\n' "$LIST" "$LIST" "$LIST" \
  | sudo tee /etc/chromium/policies/managed/nimrod-site.json >/dev/null
printf '{ "RestoreOnStartup": 4, "RestoreOnStartupURLs": ["%s"], "HomepageLocation": "%s", "ShowHomeButton": true }\n' "$URL" "$URL" \
  | sudo tee /etc/chromium/policies/recommended/nimrod-start.json >/dev/null
python3 -c 'import json,sys; [json.load(open(p)) for p in sys.argv[1:]]' \
  /etc/chromium/policies/managed/nimrod-site.json /etc/chromium/policies/recommended/nimrod-start.json
echo "wrote nimrod-site.json and nimrod-start.json for $LIST; Chromium reads them the next time it starts (check: chrome://policy)"
