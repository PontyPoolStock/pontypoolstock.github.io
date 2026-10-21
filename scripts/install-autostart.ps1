# One-time setup: makes the print agent start (hidden) every time you log in to Windows.
# Run on the till desktop:  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js first, then run this again."
}

$launcher = Join-Path $PSScriptRoot "start-print-agent.cmd"
$startup  = [Environment]::GetFolderPath("Startup")
$vbs      = Join-Path $startup "PontypoolPrintAgent.vbs"

# A .vbs wrapper runs the .cmd with no console window.
$content = 'CreateObject("WScript.Shell").Run "cmd /c ""' + $launcher + '""", 0, False'
Set-Content -Path $vbs -Value $content -Encoding ASCII

Write-Host "Installed: $vbs"
Write-Host "The print agent will now start automatically at every login."

# Start it right now too, unless it is already running.
$running = $false
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:5501/health | Out-Null; $running = $true } catch {}
if ($running) {
  Write-Host "Agent is already running."
} else {
  Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')
  Start-Sleep 3
  try {
    $h = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:5501/health).Content
    Write-Host "Agent started: $h"
  } catch {
    Write-Host "Started, but /health did not answer yet. Check again in a few seconds."
  }
}
