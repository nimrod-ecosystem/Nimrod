#!/bin/bash
# nimrod-photo-pull.sh - copy new pictures from a Google Drive folder to the drive the screen reads, now and then;
# and (2026-10-10, opt-in) copy that drive to a folder on this computer's own storage, for when the drive is not there.
#
# WHY (row 2.74; the plan is docs/for_chat pictures_order_20261009.md in the private repo): family add pictures to one
# shared Google Drive folder from their phones; the screen plays them off the drive plugged into it, which keeps
# playing when the internet does not. This fills that drive from Drive. The screen itself never talks to Google.
#
# A SHORT LIST OF JOBS (row 2.77, storage roles Stage 1; docs/for_chat storage_roles_20261010.md in the private repo).
# Mike's layout gives each device a PRIMARY (her external drive), a FALLBACK (a folder on the device's own storage,
# shown when the primary can't be reached) and a SYNC (Google Drive). NIMROD_PULL_JOBS names the jobs to run, in order:
#   drive     job 1, THE DEFAULT AND THE ONLY JOB WHEN NIMROD_PULL_JOBS IS NOT SET: Google Drive -> the drive, set by the
#             NIMROD_PULL_* settings below, exactly as before the list existed.
#   <name>    any other name (letters, digits, _): a LOCAL COPY JOB, one folder on this computer to another, set by
#             NIMROD_PULL_JOB_<NAME>_* (the name in capitals). The one it was built for is "fallback": her drive -> a
#             folder on the Pi, served by a second media agent (install-linux.sh NIMROD_FALLBACK=1), chosen on the screen
#             as "Backup folder for this screen". OFF until its name is added: NIMROD_PULL_JOBS="drive fallback".
# Each job is due on its own schedule, refuses on its own, and one that fails does not stop the next.
#
# WHAT IT NEVER DOES:
#   * WRITE TO GOOGLE. One way only, Drive -> this computer. The rclone login must be read-only (scope drive.readonly):
#     it is checked before every run, and a login that could write is refused. So a bug or a stolen Pi cannot delete
#     the family's pictures.
#   * DELETE BY DEFAULT. A picture removed from the Drive folder stays here (`rclone copy`): it frees space on Drive
#     without taking it off the screen (Mike, 2026-10-09: "No. That way you could free up space on the drive. I'd go
#     with no as the default and make it an option."). NIMROD_PULL_MIRROR_DELETES=1 switches to `rclone sync`, and even
#     then a removed picture is MOVED to a backup folder beside the target, never deleted, and a run that would remove
#     more than NIMROD_PULL_MAX_DELETE stops instead. A local copy job is the same: copy by default, and with
#     ..._MIRROR_DELETES=1 a picture gone from its source is moved beside the target, under the same kind of cap. Each
#     job decides for itself (DECISIONS 2026-10-10, "Following deletions is per drive or per direction").
#   * WRITE TO THE SYSTEM CARD BY MISTAKE. If the drive is not mounted it refuses to run: otherwise the copy would land
#     in the empty mount folder on the SD card (the media agent refuses the same way). A local copy job writes to the
#     card only when THAT job says so (..._ALLOW_SYSTEM_DISK=1); job 1's NIMROD_PULL_ALLOW_SYSTEM_DISK is not it.
#   * FILL THE CARD. A local copy job checks the free space first and keeps ..._KEEP_FREE_MB free: it copies the newest
#     pictures that fit and says how many were left out, or copies nothing and says so.
#   * INSTALL ANYTHING. rclone must already be here; an iPhone picture (HEIC, which browsers cannot show) is turned
#     into a JPEG only if a converter is already here (heif-convert, from the libheif-examples package, or
#     ImageMagick with HEIC support), and it says which it used, or that there was none. A local copy job needs only
#     find, cp and df.
#
# HOW OFTEN: nimrod-photo-pull.timer runs this every hour; this decides whether each job is due (NIMROD_PULL_EVERY,
# default daily). Mike asked "Is there much harm in checking every day": no - one listing of the folder is a few
# requests against a quota of a million a minute, and rclone downloads only pictures that are new or changed.
#
# WHAT IT LEAVES:
#   * one line per pull in the journal ("3 new pictures, 0 changed, 0 set aside (copy, 12 s)"; a local job's line starts
#     with its name, "fallback: ..."):
#       journalctl --user -u nimrod-photo-pull     (or: journalctl --user -t nimrod-photo-pull)
#   * <target>/.nimrod-pull/last-pull.json - when it last pulled and how many pictures were new today. The Photos panel
#     reads it through the media agent to say "3 new pictures today" and to list again after a pull. A dot-folder, so
#     the agent's listing leaves it (and the iPhone originals kept beside it) out of the slideshow.
#   * <target>/.nimrod-pull/last-<name>.json for a local copy job: its role, last run, pictures copied, left out for
#     space, free space on the target (for Storage roles Stage 4 to show). A different name on purpose: the Photos panel
#     reads last-pull.json, and must not say "3 new pictures today" about a night's copy to the backup folder.
#
# Settings (environment, from ~/.config/nimrod/photo-pull.env through the unit; see README.md "Pictures from Google
# Drive"). Every one is a default, argued there:
#   NIMROD_PULL_JOBS            the jobs to run, in order (default "drive": job 1 alone, as before)
# Job 1 (drive):
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
#   NIMROD_PULL_ROLE            the target's role, written in last-pull.json (default primary)
# A local copy job <name> (NIMROD_PULL_JOB_<NAME>_...):
#   FROM                the folder to copy from, e.g. the primary media agent's folder on the drive (required)
#   FROM_MOUNT          that drive's mount point; refused when it is not mounted. Empty: FROM must not be on the card
#   FROM_SYSTEM_DISK    1: FROM may be on this computer's own storage (default 0)
#   TO                  the folder to copy to, e.g. /home/<user>/nimrod-fallback (required)
#   TO_MOUNT            TO's drive's mount point, if TO is on a drive
#   ALLOW_SYSTEM_DISK   1: TO may be on this computer's own storage - the fallback's whole point, so on purpose (default 0)
#   LIMIT               all | newest:<number> | album:<folder inside FROM> (default newest:1000)
#   KEEP_FREE_MB        never leave less than this free where TO is (default 2048)
#   EXTENSIONS          which files are copied (default "jpg jpeg png gif webp bmp avif": pictures a browser shows)
#   MIRROR_DELETES      1: a picture gone from FROM is moved out of TO, beside it (default 0: copy, nothing removed)
#   MAX_DELETE          with mirroring: the most one run may move away (default 50)
#   BACKUP_DIR          with mirroring: where they go (default <TO's parent>/.nimrod-removed/<TO name>)
#   EVERY               hourly | daily | weekly | manual (default daily)
#   HOUR, UNTIL         daily / weekly: only between these hours, 0-23 (default 3 and 7: at night). UNTIL=none: no end
#   ROLE, FROM_ROLE     the target's and the source's roles, for the status file (default fallback, primary)
# Arguments: --now (pull even if not due), --dry-run (say what it would run, change nothing), --check (the guards only).
#
# Exit: 0 pulled, or not due; 2 not set up / refused; 3 the drive is not there; 4 rclone or a copy failed, or a run
# would remove more than its cap; 5 already running; 6 no room on this computer's own storage (a local copy job).
# With more than one job: the first job's failure code, after every job has had its turn.
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
ROLE="${NIMROD_PULL_ROLE:-primary}"
RCLONE="${NIMROD_PULL_RCLONE:-rclone}"
DF="${NIMROD_PULL_DF:-df}"              # the suite's stand-in for the free space; never set on a screen
STATE_DIR="${NIMROD_PULL_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/nimrod-photo-pull}"
JOBS="${NIMROD_PULL_JOBS:-drive}"

FORCE=0; DRY=0; CHECK=0
for a in "$@"; do
  case "$a" in
    --now) FORCE=1 ;;
    --dry-run) DRY=1; FORCE=1 ;;
    --check) CHECK=1; FORCE=1 ;;
    -h|--help) sed -n '2,/^set -u$/p' "$0" | sed '$d'; exit 0 ;;
    *) echo "nimrod-photo-pull: unknown argument '$a' (--now, --dry-run, --check)" >&2; exit 2 ;;
  esac
done

say() { echo "$*"; }
mkdir -p "$STATE_DIR" 2>/dev/null || true
TAB="$(printf '\t')"

# "Not set up" is said once a day, not every hour. Each job keeps its own note (REFUSED), so one job's refusal never
# silences another's.
REFUSED="refused-on"
refuse() {     # refuse CODE MESSAGE
  local code="$1"; shift
  if [ "$FORCE" = 1 ] || [ "$(cat "$STATE_DIR/$REFUSED" 2>/dev/null)" != "$(date +%F) $*" ]; then
    say "not pulling: $*"
    echo "$(date +%F) $*" > "$STATE_DIR/$REFUSED" 2>/dev/null || true
  fi
  exit "$code"
}

# The free space where PATH is (or would be), in bytes. POSIX df output, so any df reads the same.
free_bytes() {
  local p="$1"
  while [ ! -d "$p" ] && [ "$p" != "/" ] && [ "$p" != "." ]; do p="$(dirname "$p")"; done
  "$DF" -Pk "$p" 2>/dev/null | awk 'NR == 2 { printf "%.0f\n", $4 * 1024 }'
}
# Is PATH on a mounted drive, not on the system card ("/")?
on_a_drive() {
  local p="$1" m
  while [ ! -d "$p" ] && [ "$p" != "/" ]; do p="$(dirname "$p")"; done
  m="$(findmnt -n -o TARGET -T "$p" 2>/dev/null)" || return 1
  [ -n "$m" ] && [ "$m" != "/" ]
}
json_text() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037'; }
plural() { [ "$1" = 1 ] && echo "$1 $2" || echo "$1 $3"; }
is_hour() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; [ "$((10#$1))" -le 23 ]; }

# =====================================================================================================================
# JOB 1 (drive): Google Drive -> the drive. Unchanged from before the job list, but for three fields added at the end of
# last-pull.json (job, role, free_bytes) that the Photos panel does not read.
job_drive() {
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
  on_a_drive "$TARGET"
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
free_now="$(free_bytes "$TARGET")"; [ -n "$free_now" ] || free_now=null
printf '{"at": "%s", "today": "%s", "new": %d, "changed": %d, "removed": %d, "new_today": %d, "heic_converter": "%s", "heic_not_shown": %d, "mode": "%s", "ok": %s, "why": "%s", "job": "drive", "role": "%s", "from_role": "sync", "free_bytes": %s, "every": "%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$today" "$new" "$changed" "$removed" "$new_today" "$CONVERTER" "$unshown" "$MODE" "$okw" "$why" "$(json_text "$ROLE")" "$free_now" "$EVERY" \
  > "$STATUS.part" && mv -f "$STATUS.part" "$STATUS"

secs=$(( $(date +%s) - started ))
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
}

# =====================================================================================================================
# A LOCAL COPY JOB (Stage 1: the primary -> the fallback). One folder on this computer to another, with plain find, cp
# and df rather than rclone or rsync, argued: the script has to work out WHICH pictures to copy anyway (the newest N,
# what fits in the free space, newest first), so a tool that copies a list adds nothing; and this job then needs nothing
# installed - not rclone on a screen that never pulls from Drive, not rsync (absent from some images, and from the bash
# the suite runs on Windows, where the whole job runs for real rather than against a stand-in). A picture counts as
# already there when its size and modified time match (rclone's own default test); it is written under a dot-name and
# renamed, so the agent never lists one half-copied.
job_local() {
  local NAME="$1" U P S
  U="$(printf '%s' "$NAME" | tr '[:lower:]' '[:upper:]')"
  P="NIMROD_PULL_JOB_${U}_"
  S="NIMROD_PULL_JOB_${U}"
  REFUSED="refused-on-$NAME"
  setting() { local v="$P$1" x; x="${!v-}"; if [ -n "$x" ]; then printf '%s' "$x"; else printf '%s' "$2"; fi; }

  local FROM TO FROM_MOUNT TO_MOUNT FROM_SYS ALLOW JROLE FROM_ROLE JMIRROR JMAX JBACKUP JEVERY JHOUR UNTIL LIMIT EXTS KEEP_MB
  FROM="$(setting FROM '')";            TO="$(setting TO '')"
  FROM_MOUNT="$(setting FROM_MOUNT '')"; TO_MOUNT="$(setting TO_MOUNT '')"
  FROM_SYS="$(setting FROM_SYSTEM_DISK 0)"
  ALLOW="$(setting ALLOW_SYSTEM_DISK 0)"
  JROLE="$(setting ROLE fallback)";     FROM_ROLE="$(setting FROM_ROLE primary)"
  JMIRROR="$(setting MIRROR_DELETES 0)"; JMAX="$(setting MAX_DELETE 50)"
  JBACKUP="$(setting BACKUP_DIR '')"
  JEVERY="$(setting EVERY daily)";      JHOUR="$(setting HOUR 3)";  UNTIL="$(setting UNTIL 7)"
  LIMIT="$(setting LIMIT newest:1000)"
  EXTS="$(setting EXTENSIONS 'jpg jpeg png gif webp bmp avif')"
  KEEP_MB="$(setting KEEP_FREE_MB 2048)"

  # --- 1. due? Daily and weekly runs keep to a window at night (HOUR to UNTIL), so a long first copy never runs while
  # somebody is watching the slideshow; a night missed waits for the next (this is a backup: a day late costs nothing).
  case "$JEVERY" in hourly|daily|weekly|manual) ;; *) refuse 2 "$NAME: ${S}_EVERY is '$JEVERY'; it can be hourly, daily, weekly or manual" ;; esac
  is_hour "$JHOUR" || refuse 2 "$NAME: ${S}_HOUR is '$JHOUR'; it is an hour, 0 to 23"
  [ "$UNTIL" = none ] || is_hour "$UNTIL" || refuse 2 "$NAME: ${S}_UNTIL is '$UNTIL'; it is an hour, 0 to 23, or none"
  JHOUR=$((10#$JHOUR)); [ "$UNTIL" = none ] || UNTIL=$((10#$UNTIL))
  local now_s h key last_s last_key
  now_s="${NIMROD_PULL_TEST_CLOCK:-$(date +%s)}"         # the suite's clock; never set on a screen
  h=$((10#$(date -d "@$now_s" +%H)))
  key="$(date -d "@$((now_s - JHOUR * 3600))" +%F)"      # the night a run belongs to (a window past midnight included)
  in_window() {
    if [ "$UNTIL" = none ] || [ "$UNTIL" = "$JHOUR" ]; then [ "$h" -ge "$JHOUR" ]
    elif [ "$JHOUR" -lt "$UNTIL" ]; then [ "$h" -ge "$JHOUR" ] && [ "$h" -lt "$UNTIL" ]
    else [ "$h" -ge "$JHOUR" ] || [ "$h" -lt "$UNTIL" ]
    fi
  }
  local_due() {
    [ "$FORCE" = 1 ] && return 0
    read -r last_s last_key 2>/dev/null < "$STATE_DIR/last-success-$NAME" || { last_s=0; last_key=none; }
    case "$last_s" in ''|*[!0-9]*) last_s=0 ;; esac
    case "$JEVERY" in
      hourly) [ $((now_s - last_s)) -ge 3000 ] ;;
      daily)  in_window && [ "$last_key" != "$key" ] ;;
      weekly) in_window && [ $((now_s - last_s)) -ge $((6 * 86400 + 43200)) ] ;;
      manual) return 1 ;;
    esac
  }
  local_due || exit 0

  # --- 2. set up?
  [ -n "$FROM" ] || refuse 2 "$NAME: ${S}_FROM is empty (the folder to copy from, e.g. the drive's photos folder)"
  case "$FROM" in /*) ;; *) refuse 2 "$NAME: ${S}_FROM '$FROM' is not a full path" ;; esac
  [ -n "$TO" ] || refuse 2 "$NAME: ${S}_TO is empty (the folder to copy to, e.g. /home/<user>/nimrod-fallback)"
  case "$TO" in /*) ;; *) refuse 2 "$NAME: ${S}_TO '$TO' is not a full path" ;; esac
  FROM="${FROM%/}"; TO="${TO%/}"
  case "$TO/" in "$FROM"/*) refuse 2 "$NAME: ${S}_TO is inside ${S}_FROM; it must be somewhere else" ;; esac
  case "$FROM/" in "$TO"/*) refuse 2 "$NAME: ${S}_FROM is inside ${S}_TO; it must be somewhere else" ;; esac
  local k v
  for k in MIRROR_DELETES ALLOW_SYSTEM_DISK FROM_SYSTEM_DISK; do
    v="$(setting "$k" 0)"; case "$v" in 0|1) ;; *) refuse 2 "$NAME: ${S}_$k is '$v'; it is 0 or 1" ;; esac
  done
  case "$JMAX" in ''|*[!0-9]*) refuse 2 "$NAME: ${S}_MAX_DELETE is '$JMAX'; it is a number" ;; esac
  case "$KEEP_MB" in ''|*[!0-9]*) refuse 2 "$NAME: ${S}_KEEP_FREE_MB is '$KEEP_MB'; it is a number of megabytes" ;; esac
  local L_KIND L_N=0 L_ALBUM="" PFX="" SRC_DIR
  case "$LIMIT" in
    all) L_KIND=all ;;
    newest:*) L_KIND=newest; L_N="${LIMIT#newest:}"
      case "$L_N" in ''|*[!0-9]*) refuse 2 "$NAME: ${S}_LIMIT is '$LIMIT'; newest: takes a number, e.g. newest:1000" ;; esac
      [ "$L_N" -ge 1 ] || refuse 2 "$NAME: ${S}_LIMIT is '$LIMIT'; newest: takes a number above 0" ;;
    album:*) L_KIND=album; L_ALBUM="${LIMIT#album:}"; L_ALBUM="${L_ALBUM#/}"; L_ALBUM="${L_ALBUM%/}"
      [ -n "$L_ALBUM" ] || refuse 2 "$NAME: ${S}_LIMIT is '$LIMIT'; album: takes a folder inside ${S}_FROM"
      case "/$L_ALBUM/" in */../*|*/./*) refuse 2 "$NAME: ${S}_LIMIT '$LIMIT' climbs out of ${S}_FROM" ;; esac ;;
    *) refuse 2 "$NAME: ${S}_LIMIT is '$LIMIT'; it is all, newest:<number> or album:<folder>" ;;
  esac
  local ext find_ext=()
  for ext in ${EXTS//,/ }; do
    case "$ext" in *[!A-Za-z0-9]*) refuse 2 "$NAME: ${S}_EXTENSIONS has '$ext'; give endings like: jpg jpeg png" ;; esac
    [ ${#find_ext[@]} -gt 0 ] && find_ext+=(-o)
    find_ext+=(-iname "*.$ext")
  done
  [ ${#find_ext[@]} -gt 0 ] || refuse 2 "$NAME: ${S}_EXTENSIONS is empty"

  # --- 3. the primary must be there: never copy (and above all never mirror) from an empty mount folder.
  if [ -n "$FROM_MOUNT" ]; then
    FROM_MOUNT="${FROM_MOUNT%/}"
    case "$FROM/" in "$FROM_MOUNT"/*) ;; *) refuse 2 "$NAME: ${S}_FROM '$FROM' is not inside ${S}_FROM_MOUNT '$FROM_MOUNT'" ;; esac
    mountpoint -q "$FROM_MOUNT" 2>/dev/null || refuse 3 "$NAME: the drive for $FROM is not mounted ($FROM_MOUNT) - nothing copied, nothing set aside"
  elif [ "$FROM_SYS" != 1 ]; then
    on_a_drive "$FROM" || refuse 3 "$NAME: $FROM is not on a mounted drive - nothing copied, nothing set aside (${S}_FROM_SYSTEM_DISK=1 if it really is on this computer's own storage)"
  fi
  [ -d "$FROM" ] || refuse 3 "$NAME: $FROM is not there - nothing copied, nothing set aside"
  SRC_DIR="$FROM"
  if [ "$L_KIND" = album ]; then
    SRC_DIR="$FROM/$L_ALBUM"; PFX="$L_ALBUM/"
    [ -d "$SRC_DIR" ] || refuse 2 "$NAME: the album '$L_ALBUM' is not in $FROM"
  fi

  # --- 4. the target: on this computer's own storage only when THIS job says so.
  if [ -n "$TO_MOUNT" ]; then
    TO_MOUNT="${TO_MOUNT%/}"
    case "$TO/" in "$TO_MOUNT"/*) ;; *) refuse 2 "$NAME: ${S}_TO '$TO' is not inside ${S}_TO_MOUNT '$TO_MOUNT'" ;; esac
    mountpoint -q "$TO_MOUNT" 2>/dev/null || refuse 3 "$NAME: the drive for $TO is not mounted ($TO_MOUNT) - nothing copied"
  elif [ "$ALLOW" != 1 ]; then
    on_a_drive "$TO" || refuse 2 "$NAME: $TO is on this computer's own storage; a copy is put there only on purpose: ${S}_ALLOW_SYSTEM_DISK=1"
  fi
  if [ -z "$JBACKUP" ]; then JBACKUP="$(dirname "$TO")/.nimrod-removed/$(basename "$TO")"; fi
  JBACKUP="${JBACKUP%/}"
  case "$JBACKUP/" in "$TO"/*) refuse 2 "$NAME: ${S}_BACKUP_DIR '$JBACKUP' is inside the target; it must sit beside it" ;; esac
  local JMODE=copy; [ "$JMIRROR" = 1 ] && JMODE=mirror
  local KEEP=$((KEEP_MB * 1048576)) AVAIL
  AVAIL="$(free_bytes "$TO")"; [ -n "$AVAIL" ] || AVAIL=0
  mb() { echo $(( ($1 + 524287) / 1048576 )); }
  local WHEN="$JEVERY"
  case "$JEVERY" in daily|weekly) if [ "$UNTIL" = none ]; then WHEN="$JEVERY from $JHOUR:00"; else WHEN="$JEVERY $JHOUR:00-$UNTIL:00"; fi ;; esac

  if [ "$CHECK" = 1 ]; then
    say "ready ($NAME): $FROM -> $TO ($JMODE, $LIMIT, every: $WHEN; $(mb "$AVAIL") MB free there, keeps $KEEP_MB MB free)"
    exit 0
  fi

  # --- 5. one at a time (the same lock as job 1: never two jobs on the drive at once)
  if [ "$DRY" = 0 ] && command -v flock >/dev/null 2>&1; then
    exec 9>"$STATE_DIR/lock"
    flock -n 9 || { say "not pulling ($NAME): a pull is already running"; exit 5; }
  fi

  # --- 6. what to copy: the pictures in FROM (the album, or the newest N), newest first, that TO lacks or has older
  local JS="$STATE_DIR/job-$NAME"
  mkdir -p "$JS" || refuse 2 "$NAME: cannot make $JS"
  local SRC_TSV="$JS/from.tsv" SEL="$JS/selected.tsv" DST_TSV="$JS/to.tsv" PLAN="$JS/plan.tsv" GONE="$JS/gone.txt" RUNLOG="$JS/last-run.log"
  # Every picture under DIR as "modified<TAB>bytes<TAB>path", the path under PREFIX. Dot-names (.nimrod-pull with its
  # iPhone originals, .nimrod-removed, .Trash-1000) and a drive's own folders are left out, as the agent leaves them.
  # So is a name holding a tab or a line break: it cannot travel in these lists, and one would stop every night's copy.
  local NL; NL="$(printf '\nx')"; NL="${NL%x}"
  list_tree() {
    find "$1" -mindepth 1 \( -name '.*' -o -iname '$recycle.bin' -o -iname 'system volume information' \
        -o -iname 'lost+found' -o -iname 'recycler' -o -name "*$TAB*" -o -name "*$NL*" \) -prune \
        -o -type f \( "${find_ext[@]}" \) -printf '%T@\t%s\t%P\n' 2>/dev/null \
      | awk -F '\t' -v p="$2" 'BEGIN { OFS = "\t" } { rel = substr($0, length($1) + length($2) + 3); print int($1), $2, p rel }'
  }
  list_tree "$SRC_DIR" "$PFX" > "$SRC_TSV"
  local n_src; n_src=$(wc -l < "$SRC_TSV" | tr -d ' ')
  [ "$n_src" -gt 0 ] || refuse 3 "$NAME: there are no pictures in $SRC_DIR - is the right drive there? Nothing copied, nothing set aside"
  sort -t "$TAB" -k1,1nr -k3 "$SRC_TSV" > "$SEL.all"
  if [ "$L_KIND" = newest ]; then head -n "$L_N" "$SEL.all" > "$SEL"; else cp "$SEL.all" "$SEL"; fi
  list_tree "$TO" "" > "$DST_TSV"
  awk -F '\t' 'BEGIN { OFS = "\t" }
    FILENAME == ARGV[1] { have[$3] = $1 "\t" $2; next }
    !($3 in have) { print $2, "new", $3; next }
    { split(have[$3], a, "\t"); if (a[1] != $1 || a[2] != $2) print $2, "changed", $3 }' "$DST_TSV" "$SEL" > "$PLAN"
  local n_plan need room
  n_plan=$(wc -l < "$PLAN" | tr -d ' ')
  need=$(awk -F '\t' '{ s += $1 } END { printf "%.0f\n", s + 0 }' "$PLAN")
  room=$((AVAIL - KEEP))
  # With mirroring: pictures in TO that are not in FROM at all. A picture still on the primary but outside the newest N
  # is NOT one of them: it was not removed, it only stopped being among the newest.
  : > "$GONE"
  if [ "$JMIRROR" = 1 ]; then
    awk -F '\t' -v a="$PFX" 'FILENAME == ARGV[1] { src[$3] = 1; next }
      (a == "" || index($3, a) == 1) && !($3 in src) { print $3 }' "$SRC_TSV" "$DST_TSV" > "$GONE"
  fi
  local n_gone; n_gone=$(wc -l < "$GONE" | tr -d ' ')

  if [ "$DRY" = 1 ]; then
    say "would copy ($NAME): $n_plan of $n_src pictures, $(mb "$need") MB, $FROM -> $TO ($JMODE, $LIMIT)"
    say "  free there: $(mb "$AVAIL") MB; keeps $KEEP_MB MB free, so room for $(mb $((room > 0 ? room : 0))) MB"
    [ "$JMIRROR" = 1 ] && say "  would set aside $n_gone (gone from $FROM) into $JBACKUP/$(date +%F)"
    say "would write: $TO/.nimrod-pull/last-$NAME.json"
    exit 0
  fi

  local started; started=$(date +%s)
  mkdir -p "$TO/.nimrod-pull" || refuse 2 "$NAME: cannot make $TO"
  : > "$RUNLOG"
  local ok=1 why="" code=0 c_new=0 c_changed=0 used=0 removed=0 size kind rel src dst dir tmp
  if [ "$n_plan" -gt 0 ] && [ "$room" -le 0 ]; then
    ok=0; code=6; why="no room: $(mb "$AVAIL") MB free, keeps $KEEP_MB MB free"
  else
    # Newest first, while it fits; the first that does not fit ends the copy, so what is there is always the newest.
    while IFS="$TAB" read -r size kind rel; do
      [ -n "$rel" ] || continue
      [ $((used + size)) -le "$room" ] || break
      src="$FROM/$rel"; dst="$TO/$rel"; dir="$(dirname "$dst")"; tmp="$dir/.$(basename "$dst").nimrod-part"
      if mkdir -p "$dir" && cp --preserve=timestamps "$src" "$tmp" 2>>"$RUNLOG" && mv -f "$tmp" "$dst"; then
        used=$((used + size))
        if [ "$kind" = new ]; then c_new=$((c_new + 1)); else c_changed=$((c_changed + 1)); fi
      else
        rm -f "$tmp"; echo "could not copy: $rel" >> "$RUNLOG"
        ok=0; code=4; why="a copy failed (the drive went away, or the card is full?)"; break
      fi
    done < "$PLAN"
    if [ "$ok" = 1 ] && [ "$n_plan" -gt 0 ] && [ $((c_new + c_changed)) = 0 ]; then
      ok=0; code=6; why="no room: $(mb "$AVAIL") MB free, keeps $KEEP_MB MB free"
    fi
  fi
  local left=$((n_plan - c_new - c_changed))
  [ "$code" = 4 ] && left=0      # not left out for space: the copy stopped; the next run tries again

  # --- 7. mirroring: moved beside the target, never deleted, and not at all past the cap.
  if [ "$JMIRROR" = 1 ] && [ "$ok" = 1 ] && [ "$n_gone" -gt 0 ]; then
    if [ "$n_gone" -gt "$JMAX" ]; then
      ok=0; code=4; why="would set aside $n_gone pictures, more than ${S}_MAX_DELETE ($JMAX); none set aside"
    else
      local day; day="$(date +%F)"
      while IFS= read -r rel; do
        [ -n "$rel" ] || continue
        mkdir -p "$JBACKUP/$day/$(dirname "$rel")" && mv -f "$TO/$rel" "$JBACKUP/$day/$rel" && removed=$((removed + 1))
      done < "$GONE"
    fi
  fi

  # --- 8. what it did: last-<name>.json beside job 1's (never in its place), one line for the journal
  local files_now free_now okw=true STATUS="$TO/.nimrod-pull/last-$NAME.json"
  files_now=$(list_tree "$TO" "" | wc -l | tr -d ' ')
  free_now="$(free_bytes "$TO")"; [ -n "$free_now" ] || free_now=0
  [ "$ok" = 1 ] || okw=false
  printf '{"at": "%s", "today": "%s", "job": "%s", "role": "%s", "from_role": "%s", "mode": "%s", "limit": "%s", "new": %d, "changed": %d, "removed": %d, "left_for_space": %d, "files": %d, "free_bytes": %s, "keep_free_bytes": %s, "ok": %s, "why": "%s", "every": "%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date +%F)" "$NAME" "$(json_text "$JROLE")" "$(json_text "$FROM_ROLE")" "$JMODE" \
    "$(json_text "$LIMIT")" "$c_new" "$c_changed" "$removed" "$left" "$files_now" "$free_now" "$KEEP" "$okw" "$(json_text "$why")" "$JEVERY" \
    > "$STATUS.part" && mv -f "$STATUS.part" "$STATUS"

  local secs=$(( $(date +%s) - started )) line
  line="$NAME: $(plural "$c_new" "new picture" "new pictures"), $c_changed changed, $removed set aside"
  [ "$left" -gt 0 ] && line="$line, $left left out: no room (it keeps $KEEP_MB MB free)"
  if [ "$ok" = 1 ]; then
    say "$line ($JMODE, $LIMIT, $(mb "$free_now") MB free, $secs s)"
    echo "$now_s $key" > "$STATE_DIR/last-success-$NAME"
    exit 0
  fi
  say "$NAME: did not finish: $why; so far $line ($JMODE, $secs s; details in $RUNLOG)"
  exit "$code"
}

# =====================================================================================================================
# THE LIST. Checked whole before anything runs; then each job in its own subshell, so one job's refusal or failure
# (its `exit`) ends that job only.
seen=" "
for j in ${JOBS//,/ }; do
  case "$j" in
    drive) ;;
    [a-z]*) case "$j" in *[!a-z0-9_]*) refuse 2 "NIMROD_PULL_JOBS has '$j'; a job's name is small letters, digits and _" ;; esac ;;
    *) refuse 2 "NIMROD_PULL_JOBS has '$j'; a job's name is small letters, digits and _, starting with a letter" ;;
  esac
  case "$seen" in *" $j "*) refuse 2 "NIMROD_PULL_JOBS names '$j' twice" ;; esac
  seen="$seen$j "
done
[ "$seen" != " " ] || refuse 2 "NIMROD_PULL_JOBS is empty; leave it out for the Drive pull alone (drive)"
first_failure=0
for j in $seen; do
  if [ "$j" = drive ]; then ( job_drive ); rc=$?
  else ( job_local "$j" ); rc=$?; fi
  [ "$first_failure" = 0 ] && [ "$rc" != 0 ] && first_failure=$rc
done
exit "$first_failure"
