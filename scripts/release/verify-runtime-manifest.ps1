# ──────────────────────────────────────────────
# verify-runtime-manifest.ps1
#
# Verifies that the R1 self-contained runtime is present, complete, and
# embedded in the final MSI/NSIS installers. Fail-closed: any missing
# file or manifest field fails the workflow before upload.
#
# Checks:
#   1. Source EmbeddedServer/ has: node.exe, runtime-manifest.json,
#      tokentracker/bin/tracker.js, tokentracker/dashboard/dist/index.html,
#      LICENSE, LICENSE.node
#   2. runtime-manifest.json follows R1's nested node contract and its
#      archive/node.exe SHA256 values match
#   3. MSI installed layout contains the runtime after administrative install
#   4. NSIS installer archive contains the runtime via 7-Zip listing
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/release/verify-runtime-manifest.ps1 `
#     -ReleaseRoot "src-tauri/target/release" `
#     -EmbeddedServer "src-tauri/EmbeddedServer"
#
# Exit codes:
#   0  — all checks passed
#   1  — missing file / manifest mismatch / installer missing runtime
# ──────────────────────────────────────────────
param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseRoot,

    [Parameter(Mandatory = $true)]
    [string]$EmbeddedServer,

    [string]$MsiExecPath = 'msiexec.exe'
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "==> $msg" }
function Write-Fail($msg) { Write-Host "FAIL: $msg" -ForegroundColor Red }

# ── 1. Verify source EmbeddedServer/ completeness ──
Write-Step "Checking EmbeddedServer at: $EmbeddedServer"

$requiredFiles = @(
    'node.exe',
    'runtime-manifest.json',
    'LICENSE',
    'LICENSE.node',
    'tokentracker\bin\tracker.js',
    'tokentracker\package.json',
    'tokentracker\package-lock.json',
    'tokentracker\dashboard\dist\index.html'
)

function Get-MissingRuntimeFiles([string]$Root) {
    @($requiredFiles | Where-Object { -not (Test-Path (Join-Path $Root $_)) })
}

$missing = @(Get-MissingRuntimeFiles $EmbeddedServer)
foreach ($rel in $missing) {
    Write-Fail "Missing: $(Join-Path $EmbeddedServer $rel)"
}

if ($missing.Count -gt 0) {
    Write-Fail "$($missing.Count) required runtime file(s) missing"
    exit 1
}
Write-Step "All $($requiredFiles.Count) required runtime files present"

# ── 2. Verify runtime-manifest.json integrity ──
$manifestPath = Join-Path $EmbeddedServer 'runtime-manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

if (-not $manifest.node_version) {
    Write-Fail "runtime-manifest.json missing node_version"
    exit 1
}
if (-not $manifest.node) {
    Write-Fail "runtime-manifest.json missing node object"
    exit 1
}
if (-not $manifest.node.sha256) {
    Write-Fail "runtime-manifest.json missing node.sha256"
    exit 1
}
if (-not $manifest.node.official_sha256) {
    Write-Fail "runtime-manifest.json missing node.official_sha256"
    exit 1
}
if (-not $manifest.node.exe_sha256) {
    Write-Fail "runtime-manifest.json missing node.exe_sha256"
    exit 1
}

if ($manifest.node.sha256 -ne $manifest.node.official_sha256) {
    Write-Fail "Node archive SHA256 mismatch in manifest:"
    Write-Fail "  official: $($manifest.node.official_sha256)"
    Write-Fail "  actual:   $($manifest.node.sha256)"
    exit 1
}

# Verify the actual node.exe hash matches manifest
$nodeExe = Join-Path $EmbeddedServer 'node.exe'
$actualHash = (Get-FileHash $nodeExe -Algorithm SHA256).Hash.ToLower()
if ($actualHash -ne $manifest.node.exe_sha256) {
    Write-Fail "node.exe hash does not match manifest:"
    Write-Fail "  manifest: $($manifest.node.exe_sha256)"
    Write-Fail "  on disk:  $actualHash"
    exit 1
}

Write-Step "runtime-manifest.json integrity OK (node v$($manifest.node_version))"
Write-Step "  HEAD: $($manifest.head_sha)"
Write-Step "  app_version: $($manifest.app_version)"
Write-Step "  file_count: $($manifest.file_count)"

# ── 3. Verify MSI installed layout via administrative extraction ──
$msiFiles = @(Get-ChildItem (Join-Path $ReleaseRoot 'bundle\msi\*.msi') -ErrorAction SilentlyContinue)
$nsisFiles = @(Get-ChildItem (Join-Path $ReleaseRoot 'bundle\nsis\*-setup.exe') -ErrorAction SilentlyContinue)

if ($msiFiles.Count -ne 1) {
    Write-Fail "Expected exactly one MSI in $ReleaseRoot\bundle\msi; found $($msiFiles.Count)"
    exit 1
}
if ($nsisFiles.Count -ne 1) {
    Write-Fail "Expected exactly one NSIS installer in $ReleaseRoot\bundle\nsis; found $($nsisFiles.Count)"
    exit 1
}

$runtimeMissing = @()
foreach ($msi in $msiFiles) {
    Write-Step "Administratively extracting MSI: $($msi.Name)"
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
    $extractDir = Join-Path $tempRoot ("token-eyes-msi-audit-" + [guid]::NewGuid().ToString('N'))
    $resolvedExtractDir = [System.IO.Path]::GetFullPath($extractDir)
    if (-not $resolvedExtractDir.StartsWith($tempRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Fail "Refusing MSI extraction path outside temp root: $resolvedExtractDir"
        exit 1
    }

    New-Item -ItemType Directory -Path $resolvedExtractDir | Out-Null
    try {
        $process = Start-Process -FilePath $MsiExecPath -ArgumentList @(
            '/a',
            ('"' + $msi.FullName + '"'),
            '/qn',
            ('TARGETDIR="' + $resolvedExtractDir + '"')
        ) -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -ne 0) {
            Write-Fail "MSI administrative extraction failed (exit $($process.ExitCode)): $($msi.FullName)"
            $runtimeMissing += $msi.FullName
            continue
        }

        $manifestFiles = @(Get-ChildItem -LiteralPath $resolvedExtractDir -Recurse -File -Filter 'runtime-manifest.json' -ErrorAction SilentlyContinue |
            Where-Object { $_.Directory.Name -eq 'EmbeddedServer' })
        if ($manifestFiles.Count -ne 1) {
            Write-Fail "MSI $($msi.Name) missing required runtime: expected one EmbeddedServer\runtime-manifest.json, found $($manifestFiles.Count)"
            $runtimeMissing += $msi.FullName
            continue
        }

        $installedRuntime = $manifestFiles[0].Directory.FullName
        $msiMissing = @(Get-MissingRuntimeFiles $installedRuntime)
        if ($msiMissing.Count -gt 0) {
            Write-Fail "MSI $($msi.Name) missing required runtime files: $($msiMissing -join ', ')"
            $runtimeMissing += $msi.FullName
            continue
        }
        Write-Step "  MSI installed runtime layout contains all $($requiredFiles.Count) required files"
    } finally {
        if (Test-Path -LiteralPath $resolvedExtractDir) {
            Remove-Item -LiteralPath $resolvedExtractDir -Recurse -Force
        }
    }
}

# ── 4. Verify NSIS archive contents via 7-Zip listing ──
$sevenZip = $null
foreach ($name in @('7z', '7z.exe')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { $sevenZip = $cmd.Source; break }
}
$sevenZipCandidates = @(
    'C:\Program Files\7-Zip\7z.exe',
    'C:\Program Files (x86)\7-Zip\7z.exe'
)
foreach ($p in $sevenZipCandidates) {
    if (Test-Path $p) { $sevenZip = $p; break }
}

if (-not $sevenZip) {
    Write-Fail "7-Zip not found — cannot verify runtime inside NSIS"
    Write-Fail "Install 7-Zip or add it to PATH"
    exit 1
}
Write-Step "Using 7-Zip: $sevenZip"

$nsisChecks = [ordered]@{
    'runtime-manifest.json' = '(?m)EmbeddedServer[\\/]runtime-manifest\.json\s*$'
    'node.exe' = '(?m)EmbeddedServer[\\/]node\.exe\s*$'
    'LICENSE' = '(?m)EmbeddedServer[\\/]LICENSE\s*$'
    'LICENSE.node' = '(?m)EmbeddedServer[\\/]LICENSE\.node\s*$'
    'tracker.js' = '(?m)EmbeddedServer[\\/]tokentracker[\\/]bin[\\/]tracker\.js\s*$'
    'dashboard index.html' = '(?m)EmbeddedServer[\\/]tokentracker[\\/]dashboard[\\/]dist[\\/]index\.html\s*$'
}

foreach ($installer in $nsisFiles) {
    Write-Step "Inspecting installer: $(Split-Path $installer -Leaf)"
    $listing = & $sevenZip l $installer 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "7-Zip failed to list $installer (exit $LASTEXITCODE)"
        $runtimeMissing += $installer
        continue
    }

    $nsisFailed = $false
    foreach ($check in $nsisChecks.GetEnumerator()) {
        if ($listing -notmatch $check.Value) {
            Write-Fail "$($check.Key) NOT found inside $installer"
            $nsisFailed = $true
        } else {
            Write-Step "  $($check.Key) found inside installer"
        }
    }
    if ($nsisFailed) {
        $runtimeMissing += $installer
    }
}

if ($runtimeMissing.Count -gt 0) {
    Write-Fail "$($runtimeMissing.Count) installer(s) missing runtime files"
    exit 1
}

Write-Step "MSI installed layout and NSIS archive both contain the self-contained runtime."
exit 0
