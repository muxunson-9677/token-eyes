# ----------------------------------------------
# bundle-runtime.ps1
#
# Tauri self-contained runtime bundler for Token Eyes (Windows).
# Downloads pinned Node.js win-x64, verifies SHA256 against Node.js
# official SHASUMS256.txt, bundles the CLI source + built dashboard +
# production dependencies (from package-lock.json), and emits a
# runtime-manifest.json so the Rust side can verify integrity at startup.
#
# Output layout (src-tauri/EmbeddedServer-<app-version>/):
#   EmbeddedServer-<app-version>/
#     node.exe                  # Bundled Node.js (verified SHA256)
#     runtime-manifest.json     # Versions, SHA256, HEAD, build time, file count
#     LICENSE.node              # Node.js license (from archive)
#     LICENSE                   # Token Eyes MIT license
#     tokentracker/
#       bin/tracker.js
#       src/                    # CLI source (production only)
#       package.json
#       package-lock.json
#       dashboard/dist/        # Built dashboard
#       node_modules/          # Production deps (npm ci --omit=dev)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File src-tauri/scripts/bundle-runtime.ps1
#   ... -Clean       # wipe this version's EmbeddedServer-<app-version>\ and exit
# ----------------------------------------------
param([switch]$Clean)

$ErrorActionPreference = 'Stop'

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    } finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}

# Keep this pinned version in sync with TokenTrackerBar/scripts/bundle-node.sh
# and TokenTrackerWin/scripts/bundle-node.ps1. Any bump must come paired with
# running `npm test` against the new undici (Node minor releases regularly
# tighten undici header validation — see v0.24.5 release notes).
$ExpectedNodeVersion = '22.22.2'
$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { $ExpectedNodeVersion }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TauriDir   = Split-Path -Parent $ScriptDir      # src-tauri/
$RepoRoot   = Split-Path -Parent $TauriDir        # repo root
$tauriConf = Get-Content (Join-Path $TauriDir 'tauri.conf.json') -Raw | ConvertFrom-Json
$cargoToml = Get-Content (Join-Path $TauriDir 'Cargo.toml') -Raw
$cargoPackageSection = [regex]::Match($cargoToml, '(?ms)^\[package\]\s*(.*?)(?=^\[|\z)')
$cargoPackageVersion = if ($cargoPackageSection.Success) {
    [regex]::Match($cargoPackageSection.Groups[1].Value, '(?m)^version\s*=\s*"([^"]+)"\s*$')
} else {
    $null
}
if ($null -eq $cargoPackageVersion -or -not $cargoPackageVersion.Success) {
    throw 'Missing package version in src-tauri/Cargo.toml'
}
$cargoVersion = $cargoPackageVersion.Groups[1].Value
$tauriVersion = [string]$tauriConf.version
if ([string]::IsNullOrWhiteSpace($tauriVersion)) {
    throw 'Missing app version in src-tauri/tauri.conf.json'
}
if ($tauriVersion -ne $cargoVersion) {
    throw 'Cargo package version does not match tauri.conf.json version'
}
$appVersion = $cargoVersion

# Resolve the build identity before any download, bundle mutation, or clean.
# Workflow input wins only after strict validation and, when git is readable,
# exact comparison with the checked-out commit.
$providedHeadShaRaw = [Environment]::GetEnvironmentVariable('TOKEN_EYES_GIT_SHA')
$providedHeadSha = $null
if ($null -ne $providedHeadShaRaw) {
    $providedHeadSha = $providedHeadShaRaw.Trim()
    if ($providedHeadSha -notmatch '^[0-9a-fA-F]{40}$') {
        throw 'TOKEN_EYES_GIT_SHA must be exactly 40 hexadecimal characters'
    }
    $providedHeadSha = $providedHeadSha.ToLowerInvariant()
}

$gitHeadSha = $null
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $gitCandidate = (git -C $RepoRoot rev-parse HEAD 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $gitCandidate -match '^[0-9a-fA-F]{40}$') {
        $gitHeadSha = $gitCandidate.ToLowerInvariant()
    }
} catch {
    $gitHeadSha = $null
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($providedHeadSha -and $gitHeadSha -and $providedHeadSha -ne $gitHeadSha) {
    throw 'TOKEN_EYES_GIT_SHA does not match the readable git HEAD'
}
$headSha = if ($providedHeadSha) { $providedHeadSha } elseif ($gitHeadSha) { $gitHeadSha } else { 'unknown' }
$releaseIdentityRequired = (-not $Clean) -or $env:CI -eq 'true' -or $env:TOKEN_EYES_ISOLATED_INSTALLER_SMOKE -eq '1'
if ($releaseIdentityRequired -and $headSha -eq 'unknown') {
    throw 'Release bundle requires a verified 40-character Git SHA'
}
$EmbedDir   = Join-Path $TauriDir ("EmbeddedServer-" + $appVersion)

if ($Clean) {
    if (Test-Path $EmbedDir) { Remove-Item -Recurse -Force $EmbedDir }
    Write-Host "Cleaned $EmbedDir"
    exit 0
}

if ($NodeVersion -ne $ExpectedNodeVersion) {
    throw "Refusing to bundle Node v$NodeVersion; expected pinned v$ExpectedNodeVersion. Update EXPECTED_NODE_VERSION after running npm test against the new Node."
}

# -- 0. Precondition checks --
$trackerJs = Join-Path $RepoRoot 'bin\tracker.js'
$packageJson = Join-Path $RepoRoot 'package.json'
$packageLock = Join-Path $RepoRoot 'package-lock.json'
$agentRegistry = Join-Path $RepoRoot 'shared\agent-registry.json'
$providerCapabilities = Join-Path $RepoRoot 'shared\provider-capabilities.json'
$dashDist = Join-Path $RepoRoot 'dashboard\dist\index.html'

if (-not (Test-Path $trackerJs))   { throw "Missing $trackerJs — run from repo root" }
if (-not (Test-Path $packageJson)) { throw "Missing $packageJson" }
if (-not (Test-Path $packageLock)) { throw "Missing $packageLock — required for reproducible production deps" }
if (-not (Test-Path $agentRegistry)) { throw "Missing $agentRegistry" }
if (-not (Test-Path $providerCapabilities)) { throw "Missing $providerCapabilities" }
if (-not (Test-Path $dashDist)) {
    throw "Missing dashboard/dist/index.html — run 'npm run dashboard:build' first"
}

# Always start fresh — never layer over a stale runtime for this version.
if (Test-Path $EmbedDir) { Remove-Item -Recurse -Force $EmbedDir }
New-Item -ItemType Directory -Force -Path $EmbedDir | Out-Null
# Keep a tracked placeholder in the current version directory so Tauri can
# validate its exact resource path before this script creates the real runtime.
$gitkeepPath = Join-Path $EmbedDir '.gitkeep'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($gitkeepPath, "# placeholder -- real runtime created by bundle-runtime.ps1`r`n", $utf8NoBom)

# -- 1. Download Node.js win-x64 + verify SHA256 against official SHASUMS --
$zipName = "node-v$NodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/$zipName"
$sumsUrl = "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "token-eyes-runtime-$NodeVersion"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zipPath = Join-Path $tmp $zipName
$sumsPath = Join-Path $tmp 'SHASUMS256.txt'

# Invoke-WebRequest is dramatically slower and more failure-prone on large
# files while the progress bar is rendered (a well-known Windows PowerShell
# issue), which is what truncates the ~28MB Node archive and trips the
# checksum below.
$ProgressPreference = 'SilentlyContinue'

$maxAttempts = 4
$verified = $false
$expectedHash = $null
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
        Write-Host "Downloading Node.js v$NodeVersion (win-x64)... (attempt $attempt/$maxAttempts)"
        Invoke-WebRequest -Uri $nodeUrl -OutFile $zipPath
        Invoke-WebRequest -Uri $sumsUrl -OutFile $sumsPath
        $expectedHash = (Select-String -Path $sumsPath -Pattern ([regex]::Escape($zipName)) |
            Select-Object -First 1).Line.Split(' ')[0].Trim()
        if (-not $expectedHash) { throw "No checksum found for $zipName in SHASUMS256.txt" }
        $actualHash = Get-Sha256Hex $zipPath
        if ($actualHash -ne $expectedHash.ToUpper()) {
            throw "Checksum mismatch for $zipName (expected $expectedHash, got $actualHash)"
        }
        # Save the verified zip SHA256 (lowercase) for the manifest's
        # integrity check. This is the value that MUST match the official
        # SHASUMS256.txt entry. The node.exe file hash (computed later)
        # is a separate traceability field, not compared against the zip hash.
        $zipActualSha256 = $actualHash.ToLower()
        Write-Host "Checksum verified (SHA-256 = $expectedHash)"
        $verified = $true
        break
    } catch {
        Write-Warning "Download attempt $attempt failed: $($_.Exception.Message)"
        if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
        if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds ($attempt * 3) }
    }
}
if (-not $verified) {
    throw "Failed to obtain a valid Node.js v$NodeVersion archive after $maxAttempts attempts"
}

Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
$nodeExeSrc = Join-Path $tmp "node-v$NodeVersion-win-x64\node.exe"
$nodeLicenseSrc = Join-Path $tmp "node-v$NodeVersion-win-x64\LICENSE"
if (-not (Test-Path $nodeExeSrc)) { throw "node.exe not found in archive" }
if (-not (Test-Path $nodeLicenseSrc)) { throw "Node LICENSE not found in archive" }

Copy-Item $nodeExeSrc (Join-Path $EmbedDir 'node.exe')
Copy-Item $nodeLicenseSrc (Join-Path $EmbedDir 'LICENSE.node')
Copy-Item (Join-Path $RepoRoot 'LICENSE') (Join-Path $EmbedDir 'LICENSE') -ErrorAction SilentlyContinue

# Verify the bundled node.exe actually runs and reports the expected version.
$bundledVersion = (& (Join-Path $EmbedDir 'node.exe') -p 'process.versions.node').Trim()
if ($bundledVersion -ne $ExpectedNodeVersion) {
    throw "Bundled Node drifted: expected v$ExpectedNodeVersion, got v$bundledVersion"
}
# node.exe file hash — traceability only. This is NOT compared against the
# official SHASUMS256.txt because that file documents the zip archive hash,
# not the extracted binary. The zip-level check already happened above.
$nodeExeSha256 = (Get-Sha256Hex (Join-Path $EmbedDir 'node.exe')).ToLower()
Write-Host "Node.js ready - v$bundledVersion (zip SHA-256 = $zipActualSha256, exe SHA-256 = $nodeExeSha256)"

# -- 2. Bundle tokentracker source + dashboard dist + lockfile --
Write-Host 'Copying tokentracker source...'
$ttDir = Join-Path $EmbedDir 'tokentracker'
New-Item -ItemType Directory -Force -Path (Join-Path $ttDir 'bin') | Out-Null

Copy-Item $trackerJs (Join-Path $ttDir 'bin\')
Copy-Item (Join-Path $RepoRoot 'src') (Join-Path $ttDir 'src') -Recurse
Copy-Item (Join-Path $RepoRoot 'shared') (Join-Path $ttDir 'shared') -Recurse
Copy-Item $packageJson $ttDir
Copy-Item $packageLock $ttDir

# Strip devDependencies from the bundled package.json — R1 requires
# devDependencies to not enter the installer. `npm ci --omit=dev` already
# excludes them from node_modules/; this also removes the field from the
# package.json file itself so the bundled manifest is clean.
$bundledPkgJsonPath = Join-Path $ttDir 'package.json'
$bundledPkg = Get-Content $bundledPkgJsonPath -Raw | ConvertFrom-Json
if ($bundledPkg.PSObject.Properties.Name -contains 'devDependencies') {
    $bundledPkg.PSObject.Properties.Remove('devDependencies')
    $bundledPkg | ConvertTo-Json -Depth 10 | Set-Content -Path $bundledPkgJsonPath -Encoding UTF8
    Write-Host 'Stripped devDependencies from bundled package.json'
}

# Dashboard build artifacts (already built by beforeBuildCommand)
New-Item -ItemType Directory -Force -Path (Join-Path $ttDir 'dashboard') | Out-Null
Copy-Item (Join-Path $RepoRoot 'dashboard\dist') (Join-Path $ttDir 'dashboard\dist') -Recurse

# -- 3. Install production dependencies from lockfile (no `npm install`) --
Write-Host 'Installing production dependencies via npm ci --omit=dev...'
Push-Location $ttDir
try {
    # npm ci enforces lockfile fidelity; --omit=dev skips devDependencies;
    # --omit=optional skips optional deps (replaces deprecated --no-optional);
    # --ignore-scripts prevents postinstall scripts from running untrusted
    # code in the bundle env.
    # We temporarily relax ErrorActionPreference because npm writes warnings
    # (e.g. deprecation notices) to stderr, which PowerShell 5.1 treats as
    # error records and would abort the script under 'Stop'.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $npmOutput = & npm ci --omit=dev --omit=optional --ignore-scripts 2>&1 |
        Out-String
    $npmExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($npmExit -ne 0) {
        throw "npm ci --omit=dev failed (exit $npmExit): $npmOutput"
    }
} finally {
    Pop-Location
}

# -- 4. Trim node_modules bloat (keep LICENSE files for legal compliance) --
$nm = Join-Path $ttDir 'node_modules'
if (Test-Path $nm) {
    # Remove docs, tests, examples, maps — but KEEP LICENSE files.
    Get-ChildItem $nm -Recurse -File -Include `
        '*.md','*.txt','*.map','*.ts','*.d.ts', `
        'CHANGELOG*','CHANGES*','HISTORY*','.npmignore','.eslintrc*', `
        '.prettierrc*','tsconfig.json','.editorconfig' `
        -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem $nm -Recurse -Directory -Include `
        'test','tests','__tests__','examples','example','docs','.github' `
        -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

# -- 5. Generate runtime-manifest.json --
Write-Host 'Generating runtime-manifest.json...'

# Count bundled files (excluding node_modules bloat already trimmed)
$fileCount = (Get-ChildItem $EmbedDir -Recurse -File | Measure-Object).Count

# Total size in bytes
$totalBytes = (Get-ChildItem $EmbedDir -Recurse -File | Measure-Object Length -Sum).Sum

$manifest = [ordered]@{
    app_name        = 'Token Eyes'
    app_version     = $cargoVersion
    node_version    = $ExpectedNodeVersion
    # Nested `node` object matches the R1 work order's product verification
    # contract: `$Manifest.node.sha256 -ne $Manifest.node.official_sha256`.
    # `sha256` = actual zip SHA256 (computed from the downloaded archive);
    # `official_sha256` = official SHA256 (from SHASUMS256.txt);
    # `exe_sha256` = node.exe file SHA256 (traceability only, not compared).
    node = [ordered]@{
        version          = $ExpectedNodeVersion
        sha256           = $zipActualSha256
        official_sha256  = $expectedHash.ToLower()
        exe_sha256       = $nodeExeSha256
    }
    head_sha        = $headSha
    built_at_utc    = (Get-Date).ToUniversalTime().ToString('o')
    file_count      = $fileCount
    total_bytes     = $totalBytes
    bundle_script   = 'src-tauri/scripts/bundle-runtime.ps1'
    excludes        = @('.env', '.git', 'test/', 'tests/', 'docs/', 'screenshots/', 'logs/', 'devDependencies')
}

$manifestPath = Join-Path $EmbedDir 'runtime-manifest.json'
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath -Encoding UTF8

# -- 6. Final integrity check -- zip-level SHA256 must match official --
$savedManifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($savedManifest.node.sha256 -ne $savedManifest.node.official_sha256) {
    throw "runtime-manifest.json: zip SHA256 mismatch (actual=$($savedManifest.node.sha256) vs official=$($savedManifest.node.official_sha256))"
}

# -- 7. Size report --
$totalMB = [math]::Round($totalBytes / 1MB, 1)
Write-Host ""
Write-Host "======================================="
Write-Host "  Versioned Runtime Bundle Report"
Write-Host "======================================="
Write-Host "  App version:     $appVersion"
Write-Host "  Node version:    v$ExpectedNodeVersion"
Write-Host "  Zip SHA-256:     $zipActualSha256"
Write-Host "  node.exe SHA-256: $nodeExeSha256"
Write-Host "  HEAD:            $headSha"
Write-Host "  Files:            $fileCount"
Write-Host "  Total size:       $totalMB MB"
Write-Host "  Manifest:         $manifestPath"
Write-Host "======================================="
Write-Host "  Bundle complete: $EmbedDir"
