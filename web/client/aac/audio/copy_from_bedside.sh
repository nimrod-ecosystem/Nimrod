#!/usr/bin/env bash
# Copy the recordings the shipped boards use out of the private bedside build.
#
# Nothing here is staged for git: `.wav` in this folder is ignored, deliberately, so running
# this makes the board speak in a real voice ON THIS MACHINE without publishing anybody's
# voice to a public repository. Publishing them is a separate decision — see README.md.
#
# Run it from anywhere:  bash web/client/aac/audio/copy_from_bedside.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-$HOME/Documents/Nimrod_Ecosystem/Cici/dashboard_web/assets/aac/audio}"

if [ ! -d "$SRC" ]; then
  echo "The bedside recordings are not at:"
  echo "  $SRC"
  echo
  echo "Pass the folder as an argument instead:"
  echo "  bash $0 /path/to/Cici/dashboard_web/assets/aac/audio"
  exit 1
fi

# The words the two shipped boards actually say. Deliberately this list and not "*.wav": the
# private folder holds 51 clips including ones recorded for games and prompts, and copying
# words the board cannot say puts files on a public server for no reason at all.
WORDS="yes no other okay hi thank_you love_you stop wait pain help hot cold keyboard change_me bedpan tired"

copied=0
missing=""
for w in $WORDS; do
  if [ -f "$SRC/$w.wav" ]; then
    cp "$SRC/$w.wav" "$HERE/$w.wav"
    copied=$((copied + 1))
  else
    missing="$missing $w"
  fi
done

echo "copied $copied clips into $HERE"
if [ -n "$missing" ]; then
  echo "no recording exists for:$missing"
  echo "(those words fall back to the device voice, then to the word on screen — nothing breaks)"
fi
echo
echo "Now open /talk.html, hold the gear, open 'Recorded voice' and press Check."
