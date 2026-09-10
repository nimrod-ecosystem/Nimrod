# Register the Nimrod kiosk to run at logon, restarting on crash. Run once in PowerShell
# (no admin needed for a per-user logon task):
#
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Url https://nimrodecosystem.com/kiosk.html
#
# THIS GETS THE KIOSK RUNNING ONCE SOMEBODY IS LOGGED IN. It does not, by itself, get a fresh
# boot to a logged-in desktop with nobody there to type a password — that is auto-login, a
# separate, genuinely more sensitive step (it stores a password in the registry), and it is
# NOT done here. See README.md's "Auto-login" section: opt in explicitly, per machine, after
# reading what the tradeoff actually is.
param(
  [Parameter(Mandatory = $true)][string]$Url
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$run = Join-Path $here 'run-kiosk.ps1'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$run`" -Url `"$Url`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName 'NimrodKiosk' -Action $action -Trigger $trigger `
  -Settings $settings -Force | Out-Null

Write-Output "Registered scheduled task 'NimrodKiosk' (runs at logon) -> $Url"
Write-Output "Start it now without logging out:  Start-ScheduledTask -TaskName NimrodKiosk"
Write-Output "Remove it later:                   Unregister-ScheduledTask -TaskName NimrodKiosk -Confirm:`$false"
Write-Output ""
Write-Output "This starts the kiosk once somebody logs in. For a screen nobody logs into by"
Write-Output "hand, see README.md's Auto-login section before deciding whether to turn that on."
