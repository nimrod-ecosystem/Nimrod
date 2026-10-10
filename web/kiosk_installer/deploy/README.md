# The kiosk itself, as an always-on service

Boot-to-dashboard was previously custom, per-machine setup — a shell loop in one Pi's own
`~/.config/labwc/autostart`, outside git, unsupervised, undocumented anywhere a person could
find it without reading that one file on that one machine. **It was not a Nimrod product
property, and the earlier claim that Nimrod survives a power cut was walked back for exactly
that reason** — see `MIKE_CHANGE_LIST.md` §2.16. This is the fix: the same
crash-restart/starts-on-boot pattern `../media_agent/deploy/` already proved, applied to the
kiosk launch itself.

**What this proves, and what it does not.** Real process supervision (`systemctl status` /
Task Scheduler both answer "is it running, how many times has it restarted") is built and can
be verified from here — a clean `systemctl --user restart nimrod-kiosk` or `reboot` is enough
to see that. **The literal test that actually matters — pull the machine at the wall, plug it
back in — needs someone at the hardware.** A clean reboot and a power cut are different tests;
a clean reboot never has anything mid-write. Don't claim survival from this installer alone;
claim it once that test has actually been run.

## Raspberry Pi / Linux (systemd --user)

```bash
cd web/kiosk_installer/deploy
bash install-linux.sh https://nimrodecosystem.com/kiosk.html
```

No `sudo` — unlike the media agent, this needs the graphical session (Wayland compositor
already up, `WAYLAND_DISPLAY`/`XDG_RUNTIME_DIR` already set), so it installs as a **user**
systemd unit, not a system one. Run it as the user actually logged into the kiosk session.

This writes `~/.local/bin/nimrod-kiosk-launch.sh` (the network-wait + crash-profile self-heal
+ the actual Chromium launch — the exact same steps the old `autostart` loop did, just run by
systemd instead of a shell `while true`) and `~/.config/systemd/user/nimrod-kiosk.service`,
then rewrites `~/.config/labwc/autostart` to hand off to systemd instead of running Chromium
itself — keeping a timestamped backup of whatever was there before, every time it runs, not
just the first.

```bash
systemctl --user status nimrod-kiosk      # is it running? how many restarts?
journalctl --user -u nimrod-kiosk -f      # logs
```

**Getting OUT, for maintenance — found missing 2026-09-19.** Mike plugged a projector into a
real Pi to test it as a second monitor, pressed Alt+F4 to reach the desktop, and the kiosk
relaunched itself before he had time to do anything: *"the device is effectively bricked for any
other uses."* Fixed, without weakening `Restart=always` (that guarantee is why the screen never
stays frozen if Chromium genuinely crashes, and loosening it would mean an accidental close from
anyone near the keyboard leaves the screen dark instead) — this installer now also adds a labwc
keybind, **Ctrl+Alt+Shift+Esc**, four keys long on purpose so it is not something brushed
against by accident, that runs `nimrod-kiosk-pause.sh`. That script `systemctl --user stop`s the
service (a deliberate stop is never re-triggered by `Restart=`, whatever the policy) and tries to
open a terminal so there is somewhere to actually work. **It does not come back on its own** —
bring it back with `systemctl --user start nimrod-kiosk`, or a reboot.

If `~/.config/labwc/rc.xml` already exists, this installer adds the keybind into it (backed up
first, same timestamped-backup discipline as `autostart` below) rather than overwriting whatever
customization was already there.

**Lock this screen, the computer's half (2026-10-05).** The site's Ctrl+Shift+L lock (`web/client/screen_lock.js`)
keeps everything inside the dashboards working and refuses the ways out to the computer and the account. The
installer adds the computer's half (on by default; `NIMROD_LOCK=0` installs exactly what it did before):

- `nimrod-lock-helper.py` (its own user unit, `nimrod-lock-helper.service`): listens on 127.0.0.1:8765 only, accepts
  a report only from the kiosk site's origin, and keeps it in `$XDG_RUNTIME_DIR/nimrod/lock.json` (gone at every
  boot, so a reboot is always the screen as before) plus a copy in `~/.local/state/nimrod/`. `--state` shows it.
- `kiosk-launch.sh` now runs Chromium as a child: closed while **unlocked by a person** (reported in the last
  5 minutes), it exits 75 and the unit (`RestartPreventExitStatus=75`) leaves it closed. Any other exit is
  relaunched as before.
- **Ctrl+Alt+Shift+Return** brings the dashboard back (`nimrod-kiosk-back.sh`) and stays usable while locked.
- **Ctrl+Alt+Shift+T** opens an ordinary browser window with its own profile at `NIMROD_TV_URL` (default Netflix,
  `nimrod-tv.sh`). It is refused while locked, and so is the Ctrl+Alt+Shift+Esc pause.
- While locked, the helper swaps `rc.xml` for a copy with no way out (`rc.locked.xml`: no labwc defaults such as
  Alt+F4, no pause, no TV key) and back to `rc.open.xml` on unlock. It never overwrites an `rc.xml` somebody edited
  by hand. `NIMROD_LOCK_RC_SWAP=0` in the helper unit turns this off.
- **It needs one Chromium policy before the page will report**: `NIMROD_LOCK_POLICY=1 bash install-linux.sh <url>`
  writes `/etc/chromium/policies/managed/nimrod-lock-helper.json`, allowing only the kiosk's site to reach this
  computer. Without it, Chromium shows a "wants to access other apps and services on this device" box that
  stays until somebody answers it, so the launcher passes the page `lockHelper=off` and nothing above ever
  triggers. Tested by `test_lock_helper.py` (`python3 -m unittest test_lock_helper.py`).

**What this does NOT do:** get the Pi to a logged-in graphical session at boot in the first
place. Console autologin + labwc launching already works on the machines this has been tested
on; this installer only takes over from the moment `autostart` runs. If a fresh Pi doesn't
reach that point on its own, that is a `raspi-config` / autologin setup question, separate from
this installer.

## Pictures from Google Drive (Raspberry Pi, opt-in)

Family add pictures to one shared Google Drive folder from their phones; `nimrod-photo-pull.sh` copies the new ones
to the drive the screen reads. The screen never talks to Google, and keeps playing when the internet is down. One way
(Drive to here), read-only (it refuses a login that could write), and nothing is deleted unless you ask
(`NIMROD_PULL_MIRROR_DELETES=1`, and even then a removed picture is moved to a backup folder beside the target).

**Why your own Google Cloud app, once (about 15 minutes).** rclone's shared login is being retired during 2026, and
reading a folder other people add to needs the `drive.readonly` scope, which Google only gives freely to an app used
by its own maker (fewer than 100 users, personal use). So the "app" is a Google Cloud project in your account, used
by your account alone. Nobody else signs in to it.

### One-time setup (Mike)

1. **Google Cloud project.** At console.cloud.google.com, signed in as the account that owns (or was given) the shared
   folder: create a project, for example "Nimrod photos".
2. **Turn on the Drive API.** APIs & Services, Library, "Google Drive API", Enable.
3. **The consent screen.** Google Auth Platform (or "OAuth consent screen"): app name "Nimrod photos", your email as
   support and contact; audience **External**. Under Data access, add the scope `.../auth/drive.readonly`. Then, under
   Audience, press **Publish app** ("In production"). In "Testing" the login stops working after 7 days. Publishing
   a personal app does not need Google's review.
4. **The client.** Clients, Create client, type **Desktop app**, any name. Copy the **Client ID** and **Client secret**.
5. **rclone on the Pi** (installed already, or `sudo apt install rclone`). On the Pi, as the kiosk user:
   ```bash
   rclone config
   #   n (new remote)  name: nimrod-photos   storage: drive
   #   client_id / client_secret: the two from step 4
   #   scope: drive.readonly           (option 2 - "Read-only access to file metadata and file contents")
   #   service_account_file: (empty)   Edit advanced config: n
   #   Use web browser to automatically authenticate? n      (the Pi has no browser to spare)
   ```
   rclone then prints a line starting `rclone authorize "drive" "eyJ..."`. **Run that line on a computer with a
   browser and rclone** (your desktop), sign in as the same Google account, and allow it. Google warns that the app is
   unverified: Advanced, "Go to Nimrod photos (unsafe)", Continue - it is your own app. Paste the long answer it prints
   back into the Pi. "Configure this as a Shared Drive?" n. Then lock the login file down:
   ```bash
   chmod 600 ~/.config/rclone/rclone.conf
   ```
6. **Point it at the folder.** Open the folder in Drive; its id is the last part of the address
   (`.../folders/<id>`). Then `rclone config`, edit `nimrod-photos`, advanced: `root_folder_id = <id>` (or add that
   line to `~/.config/rclone/rclone.conf` under `[nimrod-photos]`). Check: `rclone lsf nimrod-photos: | head` lists
   the pictures. If the folder belongs to someone else and was shared with you, set `NIMROD_PULL_SHARED=1` below and
   use `nimrod-photos:<folder name>` instead of `root_folder_id`.
7. **Install the timer** and fill in its settings:
   ```bash
   NIMROD_PHOTO_PULL=1 bash install-linux.sh https://nimrodecosystem.com/kiosk.html
   nano ~/.config/nimrod/photo-pull.env
   #   NIMROD_PULL_REMOTE=nimrod-photos:
   #   NIMROD_PULL_TARGET=/media/<user>/<drive>/photos/family_drive
   #   NIMROD_PULL_MOUNT=/media/<user>/<drive>
   ~/.local/bin/nimrod-photo-pull.sh --check     # the guards only: "ready: ..." or what is missing
   set -a; . ~/.config/nimrod/photo-pull.env; set +a; ~/.local/bin/nimrod-photo-pull.sh --now   # the first pull, now
   journalctl --user -u nimrod-photo-pull        # one line per pull: "3 new pictures, 0 changed, 0 set aside ..."
   ```
   Point the Photos panel at the target folder (its media agent's folder, or an album in it).
8. **The login file is a secret on that Pi.** It can read everything in that Google account's Drive, not only the
   folder (`root_folder_id` limits what rclone looks at, not what the login allows). Keeping the shared folder in an
   account that holds little else limits what a lost Pi gives away. Clean it off a Pi that leaves the house:
   `rm ~/.config/rclone/rclone.conf`, and remove the app's access at myaccount.google.com, Security, Third-party access.

### Settings (`~/.config/nimrod/photo-pull.env`), each a default

| Setting | Default | Why that default |
|---|---|---|
| `NIMROD_PULL_EVERY` | `daily` | Mike: new pictures are not expected often. Checking costs nothing that matters: one listing is a few requests against Google's quota of a million a minute, and rclone downloads only what is new or changed. `hourly` for faster, `weekly`, or `manual`. The timer looks every hour; this decides. |
| `NIMROD_PULL_HOUR` | `3` | Daily and weekly pulls wait until this hour (this computer's time): overnight, when nobody is on a video call on the facility wifi. A Pi that was off then pulls at its first look after. |
| `NIMROD_PULL_MIRROR_DELETES` | `0` | Mike: a picture removed from Drive stays on the screen, so Drive's space can be freed. `1`: it is moved off the screen too, into the backup folder. |
| `NIMROD_PULL_MAX_DELETE` | `50` | With mirroring: a pull that would move more than this stops instead (a whole folder emptied by mistake). |
| `NIMROD_PULL_BACKUP_DIR` | beside the target | `<parent>/.nimrod-removed/<target name>/<date>`: beside, never inside (rclone refuses that), and a dot-folder the agent does not list. |
| `NIMROD_PULL_BWLIMIT` | `08:00,1M 22:00,off` | 1 MB/s by day, so a family member's big upload never stalls a video call on the facility wifi; no cap at night. |
| `NIMROD_PULL_CONVERT_HEIC` | `auto` | iPhone pictures (HEIC) cannot be shown by browsers. With a converter here (`heif-convert` from `libheif-examples`, or ImageMagick with HEIC) each becomes `<name>.HEIC.jpg` beside the others; the original is kept aside in `.nimrod-pull/heic`. With none, they are kept aside, not shown, and each pull says so. Nothing is installed for you. |
| `NIMROD_PULL_SHARED` | `0` | `1` when the folder was shared with this account rather than owned by it. |
| `NIMROD_PULL_JOBS` | `drive` | The jobs to run, in order. `drive` is the Drive pull above, and with this left out it is the only one, exactly as before. Add `fallback` for the copy below. |

Exit codes for a script that watches it: 0 pulled or not due, 2 not set up or refused (a login that could write), 3
the drive is not mounted, 4 rclone or a copy failed (it tries again at the next hourly look), 5 another pull is
running, 6 no room on this computer's own storage (the copy below). With two jobs, the first one's failure, after both
have run. `test_photo_pull.py` checks the guards and the commands with a stand-in rclone (`py -3.13 -m unittest
test_photo_pull.py`; it needs a bash, and skips without one).

### This computer's own copy: the fallback (opt-in, storage roles Stage 1)

Each screen has a **primary** (the drive), a **fallback** (a folder on its own storage, shown when the drive can't be
reached) and a **sync** (Google Drive). The photo pull's second job, `fallback`, fills the fallback from the drive at
night; a second media agent serves it, so the screen can pick it as **Backup folder for this screen**.

```bash
NIMROD_PHOTO_PULL=1 NIMROD_FALLBACK=1 bash install-linux.sh https://nimrodecosystem.com/kiosk.html
nano ~/.config/nimrod/photo-pull.env       # check NIMROD_PULL_JOB_FALLBACK_FROM (and _FROM_MOUNT, the drive's mount point)
#   then switch it on:  NIMROD_PULL_JOBS=drive fallback   (or just: fallback, with no Drive pull)
~/.local/bin/nimrod-photo-pull.sh --check   # "ready (fallback): ... N MB free there, keeps 2048 MB free"
set -a; . ~/.config/nimrod/photo-pull.env; set +a; ~/.local/bin/nimrod-photo-pull.sh --dry-run   # how much it would copy
```

On the screen: Media / Sources, add `http://localhost:8771`; once a panel has listed it, This screen, **Backup folder
for this screen**. The copy keeps the drive's folder layout, so albums mean the same on both.

| Setting (`NIMROD_PULL_JOB_FALLBACK_...`) | Default | Why that default |
|---|---|---|
| `LIMIT` | `newest:1000` | Her photo set's size against the card's free space has not been measured, and a copy that fills the card stops the whole computer (the journal, Chromium, updates). 1000 pictures is over four hours of slideshow without a repeat (at the Photos panel's default 15 seconds each), and about 3 to 5 GB at a phone's usual size. `all` once the card is known to hold them; `album:<folder>` for one album. |
| `KEEP_FREE_MB` | `2048` | Never leaves less than this free: an `apt` upgrade (up to about 1 GB while unpacking), Chromium's cache, and the kept journal (100 MB) all at once. It copies the newest pictures that fit, says how many it left out, or copies nothing and says so (exit 6). |
| `ALLOW_SYSTEM_DISK` | `0` (the installer writes `1`) | A copy onto this computer's own storage is made only on purpose, by this job. Job 1's `NIMROD_PULL_ALLOW_SYSTEM_DISK` does not count. |
| `MIRROR_DELETES` | `0` | Copy: a picture removed from the drive stays in the copy (DECISIONS 2026-10-10: each direction decides). `1`: it is moved to `.nimrod-removed/` beside the folder, at most `MAX_DELETE` (50) a run, or none. A picture still on the drive but no longer among the newest is not a removal. |
| `EVERY`, `HOUR`, `UNTIL` | `daily`, `3`, `7` | At night, after the Drive pull in the same run (so the night's new pictures reach the copy the same night), and never past 7: a long first copy does not share the drive with the slideshow by day. A missed night waits for the next. `UNTIL=none` for no end. |
| `EXTENSIONS` | `jpg jpeg png gif webp bmp avif` | The pictures a browser shows. iPhone originals are left out (the Drive pull keeps a JPEG of each). |
| `FROM_MOUNT` | empty | The drive's mount point: nothing is copied (or mirrored) from an empty mount folder. Empty: the source must simply not be on this computer's own storage. A source with no pictures at all is refused too. |

The agent's own settings are in `~/.config/nimrod/fallback-agent.env` (folder, `NIMROD_MEDIA_PORT=8771`, address
`127.0.0.1`); `systemctl --user status nimrod-fallback-agent`. It never writes history: the drive's agent does.

## Windows (Task Scheduler)

```powershell
cd web\kiosk_installer\deploy
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Url https://nimrodecosystem.com/kiosk.html
Start-ScheduledTask -TaskName NimrodKiosk
```

`run-kiosk.ps1` launches Edge (or Chrome if that's what's installed) with `--kiosk`, restarting
it if it exits; the scheduled task runs it at logon and keeps restarting it if it stops.

### Auto-login — read this before turning it on

**Not done by `install-windows.ps1`, on purpose.** A logon-triggered task only fires once
somebody is actually logged in — on a real bedside/wall screen there is nobody to type a
password after a reboot, which is precisely the gap named in §2.16. The fix, Windows auto-login,
is real and standard, but it is a genuinely different kind of change from everything else here:
it stores that account's password in the registry, reversibly obscured rather than encrypted at
rest. That is an acceptable tradeoff for a dedicated kiosk machine with no other purpose and no
other user account worth protecting on it — **it is not something to turn on by default, or on
a machine that is anything other than a dedicated kiosk.**

If that tradeoff is the right one for a specific machine, as an administrator:

```powershell
$key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty $key AutoAdminLogon -Value '1'
Set-ItemProperty $key DefaultUserName -Value '<the kiosk account name>'
Set-ItemProperty $key DefaultPassword -Value '<that account''s password>'
Set-ItemProperty $key DefaultDomainName -Value $env:COMPUTERNAME
```

Reverse it by setting `AutoAdminLogon` back to `'0'` and removing `DefaultPassword`. Consider a
dedicated, low-privilege local account for the kiosk rather than reusing anyone's normal login,
so what sits in that registry key is worth as little as possible if the machine is ever lost or
handled by someone else.

## Android — not covered here, genuinely different

A browser tab does not survive a reboot into itself on Android the way it can on a desktop OS —
there is no equivalent of "relaunch the browser at logon" that reaches a locked-down kiosk
state. That needs either the OS's own screen-pinning (a per-app, manual toggle, not something
an installer can turn on remotely) or a dedicated kiosk-launcher app. Recorded as a real gap,
not silently assumed to work the same way; nothing here claims Android support.
