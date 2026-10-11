# dsh-client-ui-workbench - install into a DSH profile using only Windows PowerShell.
#
# Why this exists next to tools/install.mjs:
#   tools/install.mjs needs Node on PATH. On a machine where DSH itself was installed
#   from the setup .exe, Node may not be on PATH at all -- this script does the same job
#   with nothing beyond Windows PowerShell 5.1, which every Windows machine already has.
#
# What it touches -- ONLY inside the DSH home, never the DSH program directory:
#   <DshHome>\profiles\node_modules\dsh-client-ui-workbench\   the plugin package
#   <DshHome>\profiles\<profile>\cordis.patch.yml              one appended host row
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads a .ps1 with no BOM as ANSI, so any
# non-ASCII text in this file would be mangled on exactly the machines it is meant for.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\install.ps1
#   powershell -ExecutionPolicy Bypass -File tools\install.ps1 -DryRun
#   powershell -ExecutionPolicy Bypass -File tools\install.ps1 -DshHome D:\dsh-home
#
# Afterwards you MUST restart the DSH web app once: the host half registers
# /api/rpc/workbench at boot. Without the restart the tab appears but every read and
# write fails with HTTP 404, which looks like a broken install.

[CmdletBinding()]
param(
    [string]$DshHome,
    [string]$Profile = 'web',
    [string]$Source,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$PackageName = 'dsh-client-ui-workbench'
$RowId = 'client-ui-workbench'

# Files that must exist in the source. lib/ is copied as a whole tree afterwards.
$RequiredFiles = @('package.json', 'index.js', 'lib/client.js')
# Files copied when present.
$OptionalFiles = @(
    'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md'
)

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Step([string]$Text) { Write-Host $Text }

function Fail([string]$Text) {
    Write-Host ''
    Write-Host "ERROR: $Text" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 1. Resolve the DSH home.
#    Precedence matches the harness itself: -DshHome, then $env:DSH_HOME, then ~\.dsh.
# ---------------------------------------------------------------------------
if (-not $DshHome -or $DshHome.Trim().Length -eq 0) {
    if ($env:DSH_HOME -and $env:DSH_HOME.Trim().Length -gt 0) {
        $DshHome = $env:DSH_HOME
    }
    else {
        $DshHome = Join-Path $HOME '.dsh'
    }
}
$DshHome = [System.IO.Path]::GetFullPath($DshHome)

Write-Step "== $PackageName install (PowerShell) =="
Write-Step "dsh home : $DshHome"
if (-not (Test-Path -LiteralPath $DshHome)) {
    Fail "the DSH home does not exist: $DshHome`n       Start DSH once so it creates its home, or pass -DshHome."
}

$profilesRoot = Join-Path $DshHome 'profiles'
if (-not (Test-Path -LiteralPath $profilesRoot)) {
    Fail "no 'profiles' folder under $DshHome`n       Start the DSH web app once (it creates the profile), then run this again."
}

# ---------------------------------------------------------------------------
# 2. Resolve the profile folder. Defaults to 'web'; if that has no patch file, fall
#    back to the only profile that does, so a differently-named profile still works.
# ---------------------------------------------------------------------------
$profileDir = Join-Path $profilesRoot $Profile

# The '-Profile' folder should exist. If it does not, and there is exactly one profile
# folder, use that one instead -- setup.exe installs sometimes name it differently.
if (-not (Test-Path -LiteralPath $profileDir)) {
    $dirs = @(Get-ChildItem -LiteralPath $profilesRoot -Directory -ErrorAction SilentlyContinue)
    if ($dirs.Count -eq 1) {
        $profileDir = $dirs[0].FullName
        Write-Step "profile  : $profileDir   (auto-detected; '$Profile' does not exist)"
    }
    else {
        Fail "no '$Profile' folder under $profilesRoot`n       Existing folders: $($dirs.Name -join ', ')`n       Pass -Profile <name>, or check that this is the DSH home the app actually uses."
    }
}
else {
    Write-Step "profile  : $profileDir"
}

# A profile without cordis.patch.yml is fine: the installer creates it (step 5).
$patchPath = Join-Path $profileDir 'cordis.patch.yml'

# ---------------------------------------------------------------------------
# 3. Resolve the source: the extracted package root (the folder holding package.json).
#    tools\install.ps1 -> parent of this script's folder.
# ---------------------------------------------------------------------------
if (-not $Source -or $Source.Trim().Length -eq 0) {
    $Source = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
$Source = [System.IO.Path]::GetFullPath($Source)
if (-not (Test-Path -LiteralPath (Join-Path $Source 'package.json'))) {
    Fail "no package.json under $Source`n       Run this from the extracted archive (the folder that holds index.js and tools\)."
}

foreach ($file in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $Source $file))) {
        Fail "the source is missing a required file: $file (looked in $Source)"
    }
}

$targetDir = Join-Path (Join-Path $profilesRoot 'node_modules') $PackageName
Write-Step "source   : $Source"
Write-Step "target   : $targetDir"
Write-Step "patch    : $patchPath"
if ($DryRun) { Write-Step "mode     : DRY-RUN (nothing will be written)" }

# ---------------------------------------------------------------------------
# 4. Copy the package files.
# ---------------------------------------------------------------------------
$toCopy = @()
foreach ($file in ($RequiredFiles + $OptionalFiles)) {
    if (Test-Path -LiteralPath (Join-Path $Source $file)) { $toCopy += $file }
}
# The whole lib/ tree, so a future extra module ships without touching this script.
$libSource = Join-Path $Source 'lib'
$libFiles = @()
if (Test-Path -LiteralPath $libSource) {
    $libFiles = Get-ChildItem -LiteralPath $libSource -Recurse -File |
        ForEach-Object { $_.FullName.Substring($Source.Length).TrimStart('\', '/').Replace('\', '/') }
}

if ($DryRun) {
    Write-Step ""
    Write-Step "[1/3] DRY-RUN: would write $($toCopy.Count + $libFiles.Count) file(s) to $targetDir"
    foreach ($file in $toCopy) { Write-Step "        $file" }
    foreach ($file in $libFiles) { Write-Step "        $file" }
}
else {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    foreach ($file in $toCopy) {
        $destination = Join-Path $targetDir $file
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $Source $file) -Destination $destination -Force
    }
    foreach ($file in $libFiles) {
        $destination = Join-Path $targetDir ($file.Replace('/', '\'))
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $Source ($file.Replace('/', '\'))) -Destination $destination -Force
    }
    Write-Step ""
    Write-Step "[1/3] wrote $($toCopy.Count + $libFiles.Count) file(s) to $targetDir"

    # Warn when this home looks unused. Installing into a home that DSH never reads
    # makes the plugin silently useless, and the symptom (the tab never appears) is
    # nearly identical to "you did not restart" -- so say it now, at install time.
    $sessionsDir = Join-Path $DshHome 'sessions'
    $newest = $null
    if (Test-Path -LiteralPath $sessionsDir) {
        $latest = Get-ChildItem -LiteralPath $sessionsDir -Recurse -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latest) { $newest = $latest.LastWriteTime }
    }
    if ($null -eq $newest) {
        Write-Step ""
        Write-Step "  WARNING: this home has no sessions/ (no session history at all)."
        Write-Step "  If DSH actually uses ANOTHER home, the plugin never takes effect --"
        Write-Step "  the tab simply never appears, which looks exactly like 'did not restart'."
        Write-Step "  Check with : node tools\doctor.mjs"
        Write-Step "  If another : node tools\install.mjs --dsh-home `"<that home>`""
    }
    else {
        $ageHours = ((Get-Date) - $newest).TotalHours
        if ($ageHours -gt 24) {
            Write-Step ""
            Write-Step ("  WARNING: the newest session in this home is {0:N0} hours old." -f $ageHours)
            Write-Step "  If DSH currently uses ANOTHER home, the plugin will not take effect."
            Write-Step "  Check with : node tools\doctor.mjs"
        }
    }
}

# ---------------------------------------------------------------------------
# 5. Append the host row to the patch layer, unless it is already referenced.
#    Read and write through .NET with an explicit UTF-8 encoding: Windows PowerShell's
#    own Get-Content/Out-File would decode and re-encode as ANSI and corrupt the file.
# ---------------------------------------------------------------------------
# A profile created by the setup .exe may have no patch layer at all. Create it instead of
# failing: the file is a documented, top-level YAML array, and failing here used to leave
# the user with a bare "not found" and no way forward.
$createdPatch = $false
if (-not (Test-Path -LiteralPath $patchPath)) {
    if ($DryRun) {
        Write-Step "[2/3] DRY-RUN: would create $patchPath and write the host row '$RowId'"
    }
    else {
        $header = @(
            '# Your patch layer for this dsh profile, applied after every bundle layer:'
            '# a top-level YAML array of loader patch entries (id-targeted config'
            '# overrides, disables, and insert lists; `!!js` expressions allowed).'
            '#'
            '# This file was created by the dsh-client-ui-workbench installer because the'
            '# profile had none. Delete this whole file to restore the previous state.'
        ) -join "`n"
        [System.IO.File]::WriteAllText($patchPath, "$header`n", $Utf8NoBom)
        $createdPatch = $true
        Write-Step "[2/3] this profile had no patch layer; created $patchPath"
    }
}

$patchText = if (Test-Path -LiteralPath $patchPath) { [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8) } else { '' }

if ($patchText.Contains("'$PackageName'") -or $patchText.Contains('"' + $PackageName + '"')) {
    Write-Step "[2/3] the patch layer already references '$PackageName' - left unchanged"
}
elseif ($DryRun) {
    Write-Step "[2/3] DRY-RUN: would append the host row '$RowId' to $patchPath"
}
else {
    if (-not $createdPatch) {
        $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
        $backupPath = "$patchPath.$stamp.bak"
        Copy-Item -LiteralPath $patchPath -Destination $backupPath -Force
        Write-Step "[2/3] backed up the patch layer -> $backupPath"
    }

    $block = @(
        ''
        '# >>> dsh-client-ui-workbench (managed by tools/install.ps1; delete this whole block to uninstall)'
        '# Out-of-tree web client (browser) UI plugin: the workbench tab.'
        '# A plain host row: this plugin publishes no cordis service, it only contributes UI',
        '# to the browser slot registry, so it needs no isolate realm. The browser half is',
        '# discovered through package.json dsh.client + exports["./client"] and compiled',
        '# into window.__DSH_BOOT__.'
        '- insert:'
        "    - id: $RowId"
        "      name: '$PackageName'"
        '# <<< dsh-client-ui-workbench'
        ''
    ) -join "`n"

    $suffix = ''
    if (-not $patchText.EndsWith("`n")) { $suffix = "`n" }
    [System.IO.File]::AppendAllText($patchPath, $suffix + $block, $Utf8NoBom)

    Write-Step "      appended host row '$RowId' -> '$PackageName'"
}

# ---------------------------------------------------------------------------
# 6. Self-check the copied files, then tell the user the one manual step left.
# ---------------------------------------------------------------------------
if (-not $DryRun) {
    $missing = @()
    foreach ($file in $RequiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $targetDir $file))) { $missing += $file }
    }
    if ($missing.Count -gt 0) {
        Fail "the install is incomplete, missing: $($missing -join ', ')"
    }
    Write-Step "[3/3] verified the copied package ($($RequiredFiles.Count) required files present)"
}

Write-Step ''
Write-Step '== done =='
if ($DryRun) {
    Write-Step 'This was a DRY-RUN. Re-run without -DryRun to write.'
    exit 0
}
Write-Step 'NEXT: restart DSH once.'
Write-Step '  The host half (index.js) is loaded at boot and registers /api/rpc/workbench.'
Write-Step '  Without the restart the tab appears but every read/write fails with HTTP 404.'
Write-Step '    - DSH installed from the setup .exe: quit it (tray / Start menu) and start it again.'
Write-Step '    - DSH installed through npm:         powershell -ExecutionPolicy Bypass -File tools\restart-host.ps1'
Write-Step '  Then refresh the browser tab: the workbench tab appears right of the trajectory tab.'
Write-Step ''
Write-Step 'Uninstall: delete the target folder above and remove the patch block (or restore the backup).'
exit 0
