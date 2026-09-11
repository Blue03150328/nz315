# dev-task-run.ps1 - entry point invoked by the Windows Scheduled Task "NZ315 Dev Server".
#
# ASCII-ONLY ON PURPOSE: this project lives under a path containing non-ASCII
# characters, and Windows PowerShell 5.1 may mis-decode UTF-8 .ps1 files.
# Therefore this file contains no non-ASCII literals, and every path is derived
# from $PSScriptRoot at runtime instead of being hard-coded.
#
# Why this wrapper exists at all:
#   2026-09-11 measurement showed node.exe is NOT on the persisted User PATH nor
#   the Machine PATH on this box - only WorkBuddy injects it into processes it
#   spawns. A Scheduled Task does NOT inherit that PATH, so the task cannot call
#   "node" directly. This script resolves an absolute node.exe path itself.

$ErrorActionPreference = 'Stop'

$scriptsDir = $PSScriptRoot
$root = Split-Path -Parent $scriptsDir
$logDir = Join-Path $root 'logs'
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
$runnerLog = Join-Path $logDir 'dev-task-runner.log'

function Write-RunnerLog([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $msg
  try { Add-Content -LiteralPath $runnerLog -Value $line } catch { }
}

function Resolve-NodeExe {
  # 1) node already on PATH (works if a plain Node.js install is added later)
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source)) { return $cmd.Source }

  # 2) WorkBuddy-managed node: the version folder name changes on upgrade,
  #    so glob the versions directory and take the highest by name.
  $versionsDir = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions'
  if (Test-Path -LiteralPath $versionsDir) {
    $cand = Get-ChildItem -LiteralPath $versionsDir -Directory -ErrorAction SilentlyContinue |
      Sort-Object -Property Name -Descending |
      ForEach-Object { Join-Path $_.FullName 'node.exe' } |
      Where-Object { Test-Path -LiteralPath $_ }
    if ($cand) { return @($cand)[0] }
  }

  # 3) plain Node.js install locations
  $pf = $env:ProgramFiles
  if ($pf) {
    $p = Join-Path $pf 'nodejs\node.exe'
    if (Test-Path -LiteralPath $p) { return $p }
  }
  $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  if ($pf86) {
    $p = Join-Path $pf86 'nodejs\node.exe'
    if (Test-Path -LiteralPath $p) { return $p }
  }

  return $null
}

$node = Resolve-NodeExe
if (-not $node) {
  Write-RunnerLog 'ERROR node.exe not found (checked: PATH, WorkBuddy managed dir, Program Files). Re-run scripts\install-dev-task.ps1 after installing Node.js.'
  exit 1
}

$entry = Join-Path $scriptsDir 'dev-service.mjs'
if (-not (Test-Path -LiteralPath $entry)) {
  Write-RunnerLog "ERROR entry script not found: $entry"
  exit 1
}

Write-RunnerLog "INFO starting dev-service.mjs (node=$node)"
& $node $entry
$code = $LASTEXITCODE
Write-RunnerLog "INFO dev-service.mjs exited with code=$code"
exit $code
