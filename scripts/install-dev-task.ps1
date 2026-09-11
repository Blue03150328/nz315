# install-dev-task.ps1 - register the "NZ315 Dev Server" Windows Scheduled Task.
#
# What it does:
#   - Trigger : at logon of the current user (plus a 30s delay so it does not
#               compete with the logon storm), with a 1-minute heartbeat
#               repetition attached for self-healing (see note below)
#   - Action  : powershell.exe -> scripts\dev-task-run.ps1 (window hidden)
#   - Restart : up to 3 times, 1 minute apart, when the task fails to start
#   - Limit   : no execution time limit (otherwise Task Scheduler kills it)
#   - Policy  : IgnoreNew (never run two copies), start when available,
#               keep running on battery
#
# The heartbeat repetition is the real recovery mechanism - "restart on failure"
# alone does not cover a task whose action started successfully and later died.
#
# ASCII-ONLY ON PURPOSE (same reason as dev-task-run.ps1): non-ASCII .ps1 files
# may be mis-decoded by Windows PowerShell 5.1. All paths come from $PSScriptRoot.
#
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-dev-task.ps1

$ErrorActionPreference = 'Stop'

$scriptsDir = $PSScriptRoot
$root = Split-Path -Parent $scriptsDir

$taskName = 'NZ315 Dev Server'
$runner = Join-Path $scriptsDir 'dev-task-run.ps1'
$nuxtBin = Join-Path $root 'node_modules\nuxt\bin\nuxt.mjs'

if (-not (Test-Path -LiteralPath $runner)) {
  throw "runner script not found: $runner"
}
if (-not (Test-Path -LiteralPath $nuxtBin)) {
  Write-Output "[WARN] node_modules/nuxt/bin/nuxt.mjs not found."
  Write-Output "[WARN] Run 'npm install' before the task first starts, otherwise it will exit with code 1."
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

# --- action: hidden PowerShell running our runner ---
$actionArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $runner
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs -WorkingDirectory $root

# --- trigger 1: at logon of this user, 30s delay (handles boot / sign-in) ---
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$logonTrigger.Delay = 'PT30S'

# --- trigger 2: the heartbeat (handles "supervisor process got killed") ---
# WHY THERE ARE TWO RECOVERY MECHANISMS:
#   PRIMARY   - the in-process loop inside dev-service.mjs. It restarts the dev
#               server whenever that child process dies, and never exits itself.
#   SAFETY NET- this heartbeat trigger, for the case where the supervisor process
#               ITSELF is killed (Task Manager, OOM, antivirus).
#
# Measured pitfalls on 2026-09-11, all now avoided:
#   1) RestartOnFailure only covers "Task Scheduler could not start the task".
#      It does NOT restart a task whose action started fine and later exited
#      non-zero: after killing the dev server, LastTaskResult became 0xFFFFFFFF,
#      State went to Ready, NextRunTime stayed empty, and the service stayed down.
#   2) Omitting -RepetitionDuration produces <StopAtDurationEnd>true</...> with no
#      <Duration> element => zero-length repetition window => never repeats.
#      -RepetitionDuration ([TimeSpan]::MaxValue) is rejected by the schema
#      (HRESULT 0x80041318), so use a large-but-valid value.
#   3) Attaching that repetition to the LOGON trigger still leaves NextRunTime
#      empty, because a logon trigger's repetition counts from the logon moment,
#      which is already in the past by the time the task is registered.
#      A separate -Once trigger anchored in the near future schedules properly.
#
# With MultipleInstances=IgnoreNew the heartbeat is free while healthy: the
# service keeps the task instance Running, so Task Scheduler skips each heartbeat
# instead of spawning a process.
$heartbeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

# --- settings ---
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -Hidden `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

# --- principal: run as the current user, only while logged on (no stored password) ---
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

try {
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger @($logonTrigger, $heartbeat) `
    -Settings $settings `
    -Principal $principal `
    -Force -ErrorAction Stop | Out-Null
} catch {
  Write-Output "[FAIL] registration failed: $($_.Exception.Message)"
  exit 1
}

# verify the task really exists and carries a usable heartbeat before claiming success
$verify = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $verify) {
  Write-Output "[FAIL] task not found after registration"
  exit 1
}
$nextRun = (Get-ScheduledTaskInfo -TaskName $taskName).NextRunTime
if (-not $nextRun) {
  Write-Output "[WARN] NextRunTime is empty - the heartbeat repetition may not be scheduled."
  Write-Output "[WARN] Crash recovery still works via the in-process loop in dev-service.mjs."
}

Write-Output "[OK] scheduled task registered: $taskName"
Write-Output "     user    : $currentUser"
Write-Output "     trigger : at logon (+30s delay), then heartbeat every 1 minute"
Write-Output "     next run: $nextRun"
Write-Output "     restart : 3 attempts, 1 minute apart, on non-zero exit (start failures only)"
Write-Output "     limit   : none"
Write-Output ""
Write-Output "Useful commands:"
Write-Output "  start now : Start-ScheduledTask -TaskName '$taskName'"
Write-Output "  status    : Get-ScheduledTaskInfo -TaskName '$taskName'"
Write-Output "  stop      : Stop-ScheduledTask  -TaskName '$taskName'"
Write-Output "  remove    : powershell -File scripts\uninstall-dev-task.ps1"
