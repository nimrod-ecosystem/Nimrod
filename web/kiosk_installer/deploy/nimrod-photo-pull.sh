#!/bin/bash
# nimrod-photo-pull.sh - copy new pictures from a Google Drive folder to the drive the screen reads, now and then.
#
# WHY (row 2.74; the plan is docs/for_chat pictures_order_20261009.md in the private repo): family add pictures to one
# shared Google Drive folder from their phones; the screen plays them off the drive plugged into it, which keeps
# playing when the internet does not. This fills that drive from Drive. The screen itself never talks to Google.
#
# WHAT IT NEVER DOES:
#   * WRITE TO GOOGLE. One way only, Drive -> this computer. The rclone login must be read-only (scope drive.readonly):
#     it is checked before every run, and a login that could write is refused. So a bug or a stolen Pi cannot delete
#     the family's pictures.
#   * DELETE BY DEFAULT. A picture removed from the Drive folder stays here (`rclone copy`): it frees space on Drive
#     without taking it off the screen (Mike, 2026-10-09: "No. That way you could free up space on the drive. I'd go
#     with no as the default and make it an option."). NIMROD_PULL_MIRROR_DELETES=1 switches to `rclone sync`, and even
#     then a removed picture is MOVED to a backup folder beside the target, never deleted, and a run that would remove
#     more than NIMROD_PULL_MAX_DELETE stops instead.
#   * WRITE TO THE SYSTEM CARD BY MISTAKE. If the drive is not mounted it refuses to run: otherwise the copy would land
#     in the empty mount folder on the SD card (the media agent refuses the same way).
#   * INSTALL ANYTHING. rclone must already be here; an iPhone picture (HEIC, which browsers cannot show) is turned
#     into a JPEG only if a converter is already here (heif-convert, from the libheif-examples package, or
#     ImageMagick with HEIC support), and it says which it used, or that there was none.
#
# HOW OFTEN: nimrod-photo-pull.timer runs this every hour; this decides whether a pull is due (NIMROD_PULL_EVERY,
# default daily). Mike asked "Is there much harm in checking every day": no - one listing of the folder is a few
# requests against a quota of a million a minute, and rclone downloads only pictures that are new or changed.
#
# WHAT IT LEAVES:
#   * one line per pull in the journal ("3 new pictures, 0 changed, 0 set aside (copy, 12 s)"):
#       journalctl --user -u nimrod-photo-pull     (or: journalctl --user -t nimrod-photo-pull)
#   * <target>/.nimrod-pull/last-pull.json - when it last pulled and how many pictures were new today. The Photos panel
#     reads it through the media agent to say "3 new pictures today" and to list again after a pull. A dot-folder, so
#     the agent's listing leaves it (and the iPhone originals kept beside it) out of the slideshow.
#
# Settings (environment, from ~/.config/nimrod/photo-pull.env through the unit; see README.md "Pictures from Google
# Drive"). Every one is a default, argued there:
#   NIMROD_PULL_REMOTE          the rclone remote and folder, e.g. "nimrod-photos:" (required)
#   NIMROD_PULL_TARGET          the folder the screen reads, e.g. /media/<user>/<drive>/photos/family_drive (required)
#   NIMROD_PULL_MOUNT           the drive's mount point; empty: the target must simply not be on the system card
#   NIMROD_PULL_EVERY           hourly | daily | weekly | manual (default daily)
#   NIMROD_PULL_HOUR            daily / weekly: not before this hour, 0-23, this computer's time (default 3)
#   NIMROD_PULL_MIRROR_DELETES  1: a picture removed from Drive is moved off the screen too (default 0: it stays)
#   NIMROD_PULL_MAX_DELETE      with mirroring: the most one pull may move away (default 50)
#   NIMROD_PULL_BACKUP_DIR      with mirroring: where removed pictures go (default <target's parent>/.nimrod-removed/<target name>)
#   NIMROD_PULL_BWLIMIT         rclone's --bwlimit timetable (default "08:00,1M 22:00,off": 1 MB/s by day, none at night)
#   NIMROD_PULL_SHARED          1: the folder was shared WITH this Google account (rclone --drive-shared-with-me)
#   NIMROD_PULL_CONVERT_HEIC    auto (default) | off
#   NIMROD_PULL_ALLOW_SYSTEM_DISK  1: allow a target on the system card (a test, or the Pi's own copy on purpose)
# Arguments: --now (pull even if not due), --dry-run (say what it would run, change nothing), --check (the guards only).
#
# Exit: 0 pulled, or not due; 2 not set up / refused; 3 the drive is not there; 4 rclone failed; 5 already running.
set -u

REMOTE="${NIMROD_PULL_REMOTE:-}"
TARGET="${NIMROD_PULL_TARGET:-}"
MOUNT="${NIMROD_PULL_MOUNT:-}"
EVERY="${NIMROD_PULL_EVERY:-daily}"
HOUR="${NIMROD_PULL_HOUR:-3}"
MIRROR="${NIMROD_PULL_MIRROR_DELETES:-0}"
MAX_DELETE="${NIMROD_PULL_MAX_DELETE:-50}"
BACKUP="${NIMROD_PULL_BACKUP_DIR:-}"
BWLIMIT="${NIMROD_PULL_BWLIMIT:-08:00,1M 22:00,off}"
SHARED="${NIMROD_PULL_SHARED:-0}"
CONVERT="${NIMROD_PULL_CONVERT_HEIC:-auto}"
ALLOW_SYSTEM="${NIMROD_PULL_ALLOW_SYSTEM_DISK:-0}"
RCLONE="${NIMROD_PULL_RCLONE:-rclone}"
STATE_DIR="${NIMROD_PULL_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/nimrod-photo-pull}"

FORCE=0; DRY=0; CHECK=0
for a in "$@"; do
  case "$a" in
    --now) FORCE=1 ;;
    --dry-run) DRY=1; FORCE=1 ;;
    --check) CHECK=1; FORCE=1 ;;
    -h|--help) sed -n '2,60p' "$0"; exit 0 ;;
    *) echo "nimrod-photo-pull: unknown argument '$a' (--now, --dry-run, --check)" >&2; exit 2 ;;
  esac
done

say() { echo "$*"; }
mkdir -p "$STATE_DIR" 2>/dev/null || true

# "Not set up" is said once a day, not every hour.
refuse() {     # refuse CODE MESSAGE
  local code="$1"; shift
  if [ "$FORCE" = 1 ] || [ "$(cat "$STATE_DIR/refused-on" 2>/dev/null)" != "$(date +%F) $*" ]; then
    say "not pulling: $*"
    echo "$(date +%F) $*" > "$STATE_DIR/refused-on" 2>/dev/null || true
  fi
  exit "$code"
}

# --- 1. is a pull due? (before anything else: an hourly look that is not due says nothing at all)
due() {
  [ "$FORCE" = 1 ] && return 0
  local last_s last_day now_s hour
  read -r last_s last_day 2>/dev/null < "$STATE_DIR/last-success" || { last_s=0; last_day=none; }
  case "$last_s" in ''|*[!0-9]*) last_s=0 ;; esac
  now_s=$(date +%s)
  hour=$((10#$(date +%H)))
  case "$EVERY" in
    hourly) [ $((now_s - last_s)) -ge 3000 ] ;;                       # 50 min: a late tick never skips an hour
    daily)  [ "$hour" -ge "$HOUR" ] && [ "$last_day" != "$(date +%F)" ] ;;
    weekly) [ "$hour" -ge "$HOUR" ] && [ $((now_s - last_s)) -ge $((6 * 86400 + 43200)) ] ;;
    manual) return 1 ;;
  esac
}
case "$EVERY" in hourly|daily|weekly|manual) ;; *) refuse 2 "NIMROD_PULL_EVERY is '$EVERY'; it can be hourly, daily, weekly or manual" ;; esac
case "$HOUR" in ''|*[!0-9]*) refuse 2 "NIMROD_PULL_HOUR is '$HOUR'; it is an hour, 0 to 23" ;; esac
[ "$HOUR" -le 23 ] || refuse 2 "NIMROD_PULL_HOUR is '$HOUR'; it is an hour, 0 to 23"
due || exit 0

# --- 2. is it set up?
[ -n "$REMOTE" ] || refuse 2 "NIMROD_PULL_REMOTE is empty (the rclone remote, e.g. nimrod-photos:) - see README.md, Pictures from Google Drive"
case "$REMOTE" in *:*) ;; *) refuse 2 "NIMROD_PULL_REMOTE '$REMOTE' has no ':' (an rclone remote is name: or name:folder)" ;; esac
[ -n "$TARGET" ] || refuse 2 "NIMROD_PULL_TARGET is empty (the folder the screen reads)"
case "$TARGET" in /*) ;; *) refuse 2 "NIMROD_PULL_TARGET '$TARGET' is not a full path" ;; esac
TARGET="${TARGET%/}"
case "$MIRROR" in 0|1) ;; *) refuse 2 "NIMROD_PULL_MIRROR_DELETES is '$MIRROR'; it is 0 or 1" ;; esac
case "$MAX_DELETE" in ''|*[!0-9]*) refuse 2 "NIMROD_PULL_MAX_DELETE is '$MAX_DELETE'; it is a number" ;; esac
case "$CONVERT" in auto|off) ;; *) refuse 2 "NIMROD_PULL_CONVERT_HEIC is '$CONVERT'; it is auto or off" ;; esac
command -v "$RCLONE" >/dev/null 2>&1 || refuse 2 "rclone is not installed here (sudo apt install rclone)"

# READ-ONLY, CHECKED, NOT TRUSTED: the remote's own config must say drive with scope drive.readonly.
RNAME="${REMOTE%%:*}"
CONF="$("$RCLONE" config show "$RNAME" 2>/dev/null)" || refuse 2 "rclone has no remote called '$RNAME' (rclone config, see README.md)"
RTYPE="$(printf '%s\n' "$CONF" | sed -n 's/^type *= *//p' | head -n1)"
RSCOPE="$(printf '%s\n' "$CONF" | sed -n 's/^scope *= *//p' | head -n1)"
[ "$RTYPE" = "drive" ] || refuse 2 "the rclone remote '$RNAME' is '${RTYPE:-unknown}', not Google Drive"
[ "$RSCOPE" = "drive.readonly" ] || refuse 2 "the rclone remote '$RNAME' can write to Drive (scope '${RSCOPE:-drive}'); make it read-only: rclone config, scope drive.readonly"

# --- 3. is the drive there? Never write into an empty mount folder on the system card.
drive_ok() {
  if [ -n "$MOUNT" ]; then
    MOUNT="${MOUNT%/}"
    case "$TARGET/" in "$MOUNT"/*) ;; *) refuse 2 "NIMROD_PULL_TARGET '$TARGET' is not inside NIMROD_PULL_MOUNT '$MOUNT'" ;; esac
    mountpoint -q "$MOUNT" 2>/dev/null
    return
  fi
  [ "$ALLOW_SYSTEM" = 1 ] && return 0
  local p="$TARGET" m
  while [ ! -d "$p" ] && [ "$p" != "/" ]; do p="$(dirname "$p")"; done
  m="$(findmnt -n -o TARGET -T "$p" 2>/dev/null)" || return 1
  [ -n "$m" ] && [ "$m" != "/" ]
}
drive_ok || refuse 3 "the drive for $TARGET is not mounted${MOUNT:+ ($MOUNT)} - nothing copied, nothing written to the system card"

STAGE="$TARGET/.nimrod-pull"
HEIC_DIR="$STAGE/heic"
if [ -z "$BACKUP" ]; then BACKUP="$(dirname "$TARGET")/.nimrod-removed/$(basename "$TARGET")"; fi
BACKUP="${BACKUP%/}"
case "$BACKUP/" in "$TARGET"/*) refuse 2 "NIMROD_PULL_BACKUP_DIR '$BACKUP' is inside the target; it must sit beside it" ;; esac

MODE=copy; [ "$MIRROR" = 1 ] && MODE=sync
CONVERTER=none
if [ "$CONVERT" = auto ]; then
  if command -v heif-convert >/dev/null 2>&1; then CONVERTER=heif-convert
  elif command -v magick >/dev/null 2>&1 && magick -list format 2>/dev/null | grep -qi '^ *HEIC'; then CONVERTER=magick
  elif command -v convert >/dev/null 2>&1 && convert -list format 2>/dev/null | grep -qi '^ *HEIC'; then CONVERTER=convert
  fi
fi

if [ "$CHECK" = 1 ]; then
  say "ready: $REMOTE -> $TARGET ($MODE, every: $EVERY, HEIC converter: $CONVERTER)"
  exit 0
fi

# --- 4. one at a time
if [ "$DRY" = 0 ] && command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE_DIR/lock"
  flock -n 9 || { say "not pulling: a pull is already running"; exit 5; }
fi

# --- 5. the pull
F_MAIN="$STATE_DIR/filter-main.txt"
F_HEIC="$STATE_DIR/filter-heic.txt"
RUNLOG="$STATE_DIR/last-run.log"
printf '%s\n' '- /.nimrod-pull/**' '- *.heic.jpg' '- *.heif.jpg' '- *.heic' '- *.heif' > "$F_MAIN"
printf '%s\n' '- /.nimrod-pull/**' '+ *.heic' '+ *.heif' '+ */' '- **' > "$F_HEIC"
common=(--ignore-case --bwlimit "$BWLIMIT" --drive-skip-gdocs --log-file "$RUNLOG" --log-level INFO)
[ "$SHARED" = 1 ] && common+=(--drive-shared-with-me)
main_extra=(); heic_extra=()
if [ "$MODE" = sync ]; then
  day="$(date +%F)"
  main_extra=(--backup-dir "$BACKUP/$day" --max-delete "$MAX_DELETE")
  heic_extra=(--backup-dir "$BACKUP/$day/.heic" --max-delete "$MAX_DELETE")
fi
CMD_MAIN=("$RCLONE" "$MODE" "$REMOTE" "$TARGET" --filter-from "$F_MAIN" "${common[@]}" "${main_extra[@]}")
CMD_HEIC=("$RCLONE" "$MODE" "$REMOTE" "$HEIC_DIR" --filter-from "$F_HEIC" "${common[@]}" "${heic_extra[@]}")

if [ "$DRY" = 1 ]; then
  say "would run: ${CMD_MAIN[*]}"
  [ "$CONVERT" = auto ] && say "would run: ${CMD_HEIC[*]}" && say "HEIC converter: $CONVERTER"
  say "would write: $STAGE/last-pull.json"
  exit 0
fi

started=$(date +%s)
mkdir -p "$TARGET" "$STAGE" || refuse 2 "cannot make $TARGET"
: > "$RUNLOG"
ok=1; why=""
"${CMD_MAIN[@]}"; rc=$?
[ "$rc" = 0 ] || { ok=0; why="rclone stopped (exit $rc)"; }
count() { grep -c "$1" "$RUNLOG" 2>/dev/null || true; }
new=$(count ': Copied (new)')
changed=$(count ': Copied (replaced existing)')
removed=$(grep -cE ': (Moved \(server-side\)|Deleted)' "$RUNLOG" 2>/dev/null || true)

# iPhone pictures: originals kept aside (a dot-folder the listing leaves out), shown as JPEGs beside the rest.
converted=0; reconverted=0; unshown=0; heic_removed=0
if [ "$CONVERT" = auto ] && [ "$ok" = 1 ]; then
  mkdir -p "$HEIC_DIR"
  : > "$RUNLOG"
  "${CMD_HEIC[@]}"; rc=$?
  [ "$rc" = 0 ] || { ok=0; why="rclone stopped on the iPhone pictures (exit $rc)"; }
  while IFS= read -r -d '' f; do
    rel="${f#"$HEIC_DIR"/}"
    out="$TARGET/$rel.jpg"
    if [ -e "$out" ] && [ ! "$f" -nt "$out" ]; then continue; fi
    if [ "$CONVERTER" = none ]; then unshown=$((unshown + 1)); continue; fi
    mkdir -p "$(dirname "$out")"
    tmp="$(dirname "$out")/.$(basename "$out").part.jpg"        # a dot-file: never listed half-written
    case "$CONVERTER" in
      heif-convert) heif-convert -q 90 "$f" "$tmp" >/dev/null 2>&1 ;;
      *) "$CONVERTER" "$f" -auto-orient -quality 90 "$tmp" >/dev/null 2>&1 ;;
    esac
    if [ -s "$tmp" ]; then
      [ -e "$out" ] && reconverted=$((reconverted + 1)) || converted=$((converted + 1))
      touch -r "$f" "$tmp" 2>/dev/null; mv -f "$tmp" "$out"
    else rm -f "$tmp"; unshown=$((unshown + 1)); fi
  done < <(find "$HEIC_DIR" -type f \( -iname '*.heic' -o -iname '*.heif' \) -print0 2>/dev/null)
  # Mirroring: a JPEG whose iPhone original went from Drive goes to the backup folder too.
  if [ "$MODE" = sync ]; then
    while IFS= read -r -d '' out; do
      rel="${out#"$TARGET"/}"
      [ -e "$HEIC_DIR/${rel%.*}" ] && continue
      mkdir -p "$BACKUP/$(date +%F)/$(dirname "$rel")" && mv -f "$out" "$BACKUP/$(date +%F)/$rel" && heic_removed=$((heic_removed + 1))
    done < <(find "$TARGET" -path "$STAGE" -prune -o -type f \( -iname '*.heic.jpg' -o -iname '*.heif.jpg' \) -print0 2>/dev/null)
  fi
fi
new=$((new + converted)); changed=$((changed + reconverted)); removed=$((removed + heic_removed))

# --- 6. what it did: last-pull.json for the panel, one line for the journal
STATUS="$STAGE/last-pull.json"
today="$(date +%F)"
prev_day="$(sed -n 's/.*"today": *"\([0-9-]*\)".*/\1/p' "$STATUS" 2>/dev/null | head -n1)"
prev_new="$(sed -n 's/.*"new_today": *\([0-9]*\).*/\1/p' "$STATUS" 2>/dev/null | head -n1)"
[ "$prev_day" = "$today" ] && [ -n "$prev_new" ] || prev_new=0
new_today=$((prev_new + new))
okw=true; [ "$ok" = 1 ] || okw=false
printf '{"at": "%s", "today": "%s", "new": %d, "changed": %d, "removed": %d, "new_today": %d, "heic_converter": "%s", "heic_not_shown": %d, "mode": "%s", "ok": %s, "why": "%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$today" "$new" "$changed" "$removed" "$new_today" "$CONVERTER" "$unshown" "$MODE" "$okw" "$why" \
  > "$STATUS.part" && mv -f "$STATUS.part" "$STATUS"

secs=$(( $(date +%s) - started ))
plural() { [ "$1" = 1 ] && echo "$1 $2" || echo "$1 $3"; }
line="$(plural "$new" "new picture" "new pictures"), $changed changed, $removed set aside"
[ "$unshown" -gt 0 ] && line="$line, $(plural "$unshown" "iPhone picture (HEIC)" "iPhone pictures (HEIC)") not shown: no converter here (heif-convert, from libheif-examples, would do it)"
[ "$converted" -gt 0 ] && line="$line, $converted converted from HEIC with $CONVERTER"
if [ "$ok" = 1 ]; then
  say "$line ($MODE, $secs s)"
  echo "$(date +%s) $today" > "$STATE_DIR/last-success"
  exit 0
fi
say "pull did not finish: $why; so far $line ($MODE, $secs s; details in $RUNLOG)"
exit 4
