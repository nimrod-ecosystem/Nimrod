# Nimrod kiosk — Windows run wrapper. Launches the browser in kiosk mode, restarting on
# crash. Register it to run at logon with install-windows.ps1 — do not run this by hand except
# to test it, since a crash loop with nobody watching is exactly what it is for.
param(
  [Parameter(Mandatory = $true)][string]$Url
)

# Edge first (it ships with every Windows install already, no separate download), Chrome as a
# fallback for a machine that has it and not Edge. Either one's --kiosk flag does the same job.
function Find-KioskBrowser {
  $edge = Get-Command msedge -ErrorAction SilentlyContinue
  if ($edge) { return $edge.Source }
  $chrome = Get-Command chrome -ErrorAction SilentlyContinue
  if ($chrome) { return $chrome.Source }
  $edgeDefault = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  if (Test-Path $edgeDefault) { return $edgeDefault }
  return $null
}

$browser = Find-KioskBrowser
if (-not $browser) {
  Write-Error "No kiosk-capable browser found (looked for msedge, chrome). Install one and re-run."
  exit 1
}

while ($true) {
  # --kiosk fullscreens with no chrome; --no-first-run skips the setup screens that would
  # otherwise block the first-ever launch on a fresh machine, silently, with nobody there to
  # click through them.
  & $browser --kiosk $Url --no-first-run --disable-session-crashed-bubble
  Start-Sleep -Seconds 3   # the browser exited (crash, closed, whatever) — relaunch
}
