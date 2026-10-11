# Restart the DSH web host so host-half plugin changes take effect.
#
# Scope: this restarts a DSH that was installed through npm, i.e. one that has a
# `dsh` command / %APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js.
# If DSH on this machine came from the setup .exe, there is no such entry point and
# this script cannot restart it -- it says so and exits. Restart the APP instead
# (quit it from the tray / Start menu, then start it again).
#
# Why Start-Process: the agent sandbox puts tool children in a kill-on-close job
# object, so a host started as a plain child dies with the tool call. Start-Process
# detaches the new host from that tree.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
[CmdletBinding()]
param(
  [int]$Port = 3080,
  [string]$LogDir = (Join-Path $env:TEMP 'dsh-web-logs'),
  [int]$TimeoutSeconds = 60,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

# node: prefer whatever is on PATH; the literal path below is just this repo's dev machine.
$node = $null
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) { $node = $nodeCmd.Source }
elseif (Test-Path 'E:\work\nodejs\node.exe') { $node = 'E:\work\nodejs\node.exe' }

# The dsh CLI entry point. It must be the real .js file, because it is handed to node:
# npm on Windows also installs `dsh.cmd` / `dsh.ps1` shims, and `Get-Command dsh`
# resolves to the .ps1 one -- feeding that to node makes node parse PowerShell as
# JavaScript. So shims are skipped and only a .js path is accepted.
$dshCandidates = @()
$dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
if ($dshCmd -and $dshCmd.Source -and $dshCmd.Source.EndsWith('.js')) { $dshCandidates += $dshCmd.Source }
$dshCandidates += (Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\lib\bin.js')
$dshCandidates += (Join-Path $env:LOCALAPPDATA 'npm\node_modules\@deepseek-ai\dsh\lib\bin.js')

$dshBin = $null
foreach ($candidate in $dshCandidates) {
  if ($candidate -and (Test-Path $candidate)) { $dshBin = $candidate; break }
}

if (-not $dshBin) {
  Write-Host "== this script does not apply on this machine ==" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "No dsh CLI entry point found. Looked for:"
  foreach ($candidate in $dshCandidates) { Write-Host "  $candidate" }
  Write-Host ""
  Write-Host "This script restarts a DSH installed through npm (the 'dsh' command)."
  Write-Host "If DSH here came from the setup .exe, restart the application instead:"
  Write-Host "  quit DeepSeek Harness (tray icon / Start menu), then start it again."
  exit 1
}
if (-not $node) {
  Write-Host "== node not found ==" -ForegroundColor Yellow
  Write-Host "No 'node' on PATH, and the fallback path does not exist."
  Write-Host "Start DSH the normal way instead (tray icon / Start menu)."
  exit 1
}

Write-Host "== restart dsh web =="
Write-Host "node    : $node"
Write-Host "dsh bin : $dshBin"
Write-Host "port    : $Port"
Write-Host ""

function Get-PortOwner([int]$p) {
  $line = netstat -ano | Select-String ("127.0.0.1:{0}\s+.*LISTENING" -f $p) | Select-Object -First 1
  if (-not $line) { return $null }
  $parts = ($line.Line -split '\s+') | Where-Object { $_ -ne '' }
  return [int]$parts[-1]
}

# 1. stop the current owner
$pid0 = Get-PortOwner $Port
if ($pid0) {
  Write-Host "[1/4] stopping pid $pid0"
  Stop-Process -Id $pid0 -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "[1/4] nothing listening on $Port"
}

# 2. wait for the port to free
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-PortOwner $Port)) { break }
  Start-Sleep -Milliseconds 400
}
if (Get-PortOwner $Port) { throw "port $Port is still held after ${TimeoutSeconds}s" }
Write-Host "[2/4] port $Port is free"

if ($NoStart) {
  Write-Host "[3/4] -NoStart: not starting a replacement"
  Write-Host "== done =="
  exit 0
}

# 3. start a detached host
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir '_dsh-web-server.log'
$errLog = Join-Path $LogDir '_dsh-web-server.err.log'
Remove-Item $outLog, $errLog -Force -ErrorAction SilentlyContinue

$proc = Start-Process -FilePath $node `
  -ArgumentList @($dshBin, 'web', '--no-open') `
  -WorkingDirectory $LogDir `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden `
  -PassThru
Write-Host "[3/4] started pid $($proc.Id); logs: $outLog / $errLog"

# 4. wait for it to listen
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$pid1 = $null
while ((Get-Date) -lt $deadline) {
  $pid1 = Get-PortOwner $Port
  if ($pid1) { break }
  if ($proc.HasExited) { break }
  Start-Sleep -Milliseconds 500
}

if (-not $pid1) {
  Write-Host "[4/4] FAILED: nothing listening on $Port"
  if (Test-Path $errLog) {
    Write-Host "--- $errLog (tail) ---"
    Get-Content $errLog -Tail 25 | ForEach-Object { "  $_" }
  }
  exit 1
}

Write-Host "[4/4] listening on $Port (pid $pid1)"
Write-Host ""
Write-Host "== done ==" -ForegroundColor Green
Write-Host "url: http://127.0.0.1:$Port"
if (Test-Path $errLog) {
  $err = Get-Content $errLog -Raw
  if ($err -and $err.Trim() -ne '') {
    Write-Host ""
    Write-Host "--- stderr (tail) ---"
    Get-Content $errLog -Tail 15 | ForEach-Object { "  $_" }
  }
}