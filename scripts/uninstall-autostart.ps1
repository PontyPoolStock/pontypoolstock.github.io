# Removes the auto-start entry created by install-autostart.ps1.
$vbs = Join-Path ([Environment]::GetFolderPath("Startup")) "PontypoolPrintAgent.vbs"
if (Test-Path $vbs) { Remove-Item $vbs -Force; Write-Host "Removed auto-start." } else { Write-Host "Auto-start was not installed." }
Write-Host "If the agent is running now, close it from Task Manager (node.exe) or restart the PC."
