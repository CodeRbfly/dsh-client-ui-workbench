# dsh-client-ui-workbench - Windows convenience wrapper.
#
# The real installer is tools/install.mjs (Node, cross-platform, offline).
# This wrapper exists only so Windows users can keep typing .\deploy.ps1.
#
# Deliberately ASCII-only: Windows PowerShell 5.1 reads a .ps1 without a UTF-8
# BOM as ANSI, which mangles non-ASCII text and can break the parser. Keeping
# this file ASCII removes that entire failure mode.
#
# Usage:
#   .\deploy.ps1                 # install from this repository
#   .\deploy.ps1 -DryRun         # print the plan, write nothing
#   .\deploy.ps1 -Tarball dist\dsh-client-ui-workbench-0.1.0.tgz
#   .\deploy.ps1 -Uninstall
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$DshHome,
  [string]$Tarball,
  [switch]$DryRun,
  [switch]$Uninstall,
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$arguments = @()
if ($Uninstall) {
  $arguments += (Join-Path $root 'tools\uninstall.mjs')
} else {
  $arguments += (Join-Path $root 'tools\install.mjs')
  if ($Tarball) { $arguments += @('--tarball', $Tarball) } else { $arguments += @('--from', $root) }
}
$arguments += @('--profile', $Profile)
if ($DshHome) { $arguments += @('--dsh-home', $DshHome) }
if ($DryRun) { $arguments += '--dry-run' }
if ($SkipVerify) { $arguments += '--skip-verify' }

& node @arguments
exit $LASTEXITCODE