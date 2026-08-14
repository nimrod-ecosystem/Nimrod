# Register the Nimrod media agent to run at logon (hidden), restarting on crash.
# Run once in PowerShell (no admin needed for a per-user logon task):
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$run = Join-Path $here 'run-agent.ps1'

if (-not (Test-Path (Join-Path $here 'agent.env'))) {
  Write-Warning "No agent.env next to this script. Copy agent.env.example -> agent.env and edit it first."
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$run`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName 'NimrodMediaAgent' -Action $action -Trigger $trigger `
  -Settings $settings -Force | Out-Null

Write-Output "Registered scheduled task 'NimrodMediaAgent' (runs at logon)."
Write-Output "Start it now without logging out:  Start-ScheduledTask -TaskName NimrodMediaAgent"
Write-Output "Remove it later:                   Unregister-ScheduledTask -TaskName NimrodMediaAgent -Confirm:`$false"
