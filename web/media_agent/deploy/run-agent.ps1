# Nimrod media agent — Windows run wrapper.
# Loads agent.env (same folder) into the environment, then runs the agent in a
# restart loop (so a crash or reboot-race comes back). Register it to run at logon
# with install-windows.ps1.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# load agent.env: KEY=VALUE lines, '#' comments ignored, value is the rest of the line
$envFile = Join-Path $here 'agent.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $idx = $line.IndexOf('=')
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim()
    if ($key) { [Environment]::SetEnvironmentVariable($key, $val, 'Process') }
  }
}

$agent = Join-Path (Split-Path -Parent $here) 'agent.py'
$py = (Get-Command python).Source

while ($true) {
  & $py $agent      # reads NIMROD_MEDIA_ROOT / _PORT / _ORIGIN from the environment
  Start-Sleep -Seconds 3   # it should run forever; if it exits, restart
}
