# uninstall-dev-task.ps1 - remove the "NZ315 Dev Server" Scheduled Task.
#
# ASCII-ONLY ON PURPOSE (same reason as dev-task-run.ps1).
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uninstall-dev-task.ps1

$ErrorActionPreference = 'Stop'

$taskName = 'NZ315 Dev Server'

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Output "[SKIP] scheduled task not found: $taskName"
  exit 0
}

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false

Write-Output "[OK] scheduled task removed: $taskName"
Write-Output "     note: the dev server process it started may still be running;"
Write-Output "           stop it from Task Manager (node.exe) if you need port 3100 free."
