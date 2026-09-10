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

**What this does NOT do:** get the Pi to a logged-in graphical session at boot in the first
place. Console autologin + labwc launching already works on the machines this has been tested
on; this installer only takes over from the moment `autostart` runs. If a fresh Pi doesn't
reach that point on its own, that is a `raspi-config` / autologin setup question, separate from
this installer.

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
