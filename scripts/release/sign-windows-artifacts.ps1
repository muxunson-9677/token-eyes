# ──────────────────────────────────────────────
# sign-windows-artifacts.ps1
#
# Signs Token Eyes Windows artifacts (EXE / MSI / NSIS) with an
# Authenticode code-signing certificate. Uses SHA-256 digest and a
# trusted RFC 3161 timestamp server.
#
# The certificate MUST be a formal, trusted code-signing certificate
# (OV/EV from a public CA). Self-signed certificates are explicitly
# rejected — they cannot satisfy the R2 B5 "trusted publisher" gate.
#
# Inputs (environment variables):
#   WINDOWS_CERT_PFX_BASE64  — base64-encoded PFX (CI secret)
#   WINDOWS_CERT_PASSWORD    — PFX password (CI secret)
#   WINDOWS_CERT_SUBJECT     — expected publisher subject (for verification)
#
# Or (local file):
#   WINDOWS_CERT_PFX_PATH    — path to a .pfx file
#   WINDOWS_CERT_PASSWORD    — PFX password
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/release/sign-windows-artifacts.ps1 -Artifacts @('a.exe','b.msi')
#   ... -Artifacts @('a.exe') -TimestampServer http://timestamp.digicert.com
#
# Exit codes:
#   0  — all artifacts signed successfully
#   1  — missing cert / signtool / signing failure
# ──────────────────────────────────────────────
param(
    [Parameter(Mandatory = $true)]
    [string[]]$Artifacts,

    [string]$TimestampServer = 'http://timestamp.digicert.com',

    [string]$DigestAlgorithm = 'SHA256'
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "==> $msg" }
function Write-Fail($msg) { Write-Host "FAIL: $msg" -ForegroundColor Red }

# ── 1. Locate signtool.exe ──
$signTool = $null
$candidates = @(
    'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe',
    'C:\Program Files\Windows Kits\10\bin\*\x64\signtool.exe'
)
foreach ($pattern in $candidates) {
    $found = Get-ChildItem $pattern -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { $signTool = $found.FullName; break }
}
if (-not $signTool) {
    # Fall back to PATH lookup
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { $signTool = $cmd.Source }
}
if (-not $signTool) {
    Write-Fail "signtool.exe not found — install Windows SDK"
    exit 1
}
Write-Step "Using signtool: $signTool"

# ── 2. Resolve PFX certificate ──
$pfxPath = $null
$cleanupCert = $false

if ($env:WINDOWS_CERT_PFX_PATH -and (Test-Path $env:WINDOWS_CERT_PFX_PATH)) {
    $pfxPath = $env:WINDOWS_CERT_PFX_PATH
    Write-Step "Using PFX from path: $pfxPath"
} elseif ($env:WINDOWS_CERT_PFX_BASE64) {
    $pfxPath = Join-Path ([System.IO.Path]::GetTempPath()) "token-eyes-cs-cert-$(Get-Random).pfx"
    $cleanupCert = $true
    try {
        Write-Step "Decoding PFX from WINDOWS_CERT_PFX_BASE64 to $pfxPath"
        [System.IO.File]::WriteAllBytes($pfxPath, [System.Convert]::FromBase64String($env:WINDOWS_CERT_PFX_BASE64))
    } catch {
        Write-Fail "Failed to decode WINDOWS_CERT_PFX_BASE64: $($_.Exception.Message)"
        exit 1
    }
} else {
    Write-Fail "No certificate provided — set WINDOWS_CERT_PFX_BASE64 or WINDOWS_CERT_PFX_PATH"
    Write-Fail "Self-signed certificates are NOT acceptable for external release (R2 B5 gate)."
    exit 1
}

if (-not $env:WINDOWS_CERT_PASSWORD) {
    Write-Fail "WINDOWS_CERT_PASSWORD is required"
    exit 1
}

# ── 3. Verify the certificate is NOT self-signed ──
try {
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
        $pfxPath, $env:WINDOWS_CERT_PASSWORD, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
    )
    if ($cert.Subject -eq $cert.Issuer) {
        Write-Fail "The provided certificate is SELF-SIGNED (Subject == Issuer)."
        Write-Fail "Self-signed certificates are explicitly rejected for external release."
        Write-Fail "Subject: $($cert.Subject)"
        exit 1
    }
    Write-Step "Certificate subject: $($cert.Subject)"
    Write-Step "Certificate issuer:  $($cert.Issuer)"
    Write-Step "Thumbprint:          $($cert.Thumbprint)"
    Write-Step "NotAfter:            $($cert.NotAfter)"

    if ($cert.NotAfter -lt (Get-Date)) {
        Write-Fail "Certificate has EXPIRED on $($cert.NotAfter)"
        exit 1
    }
} catch {
    Write-Fail "Failed to load/verify certificate: $($_.Exception.Message)"
    if ($cleanupCert -and (Test-Path $pfxPath)) { Remove-Item -Force $pfxPath }
    exit 1
} finally {
    if ($cert) { $cert.Dispose() }
}

# ── 4. Sign each artifact ──
$failed = @()
foreach ($artifact in $Artifacts) {
    if (-not (Test-Path $artifact)) {
        Write-Fail "Artifact not found: $artifact"
        $failed += $artifact
        continue
    }
    Write-Step "Signing: $artifact"
    & $signTool sign `
        /fd $DigestAlgorithm `
        /td $DigestAlgorithm `
        /tr $TimestampServer `
        /f $pfxPath `
        /p $env:WINDOWS_CERT_PASSWORD `
        $artifact 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "signtool failed (exit $LASTEXITCODE) for $artifact"
        $failed += $artifact
    }
}

# ── 5. Cleanup temp cert ──
if ($cleanupCert -and (Test-Path $pfxPath)) {
    Remove-Item -Force $pfxPath
    Write-Step "Cleaned up temp PFX"
}

if ($failed.Count -gt 0) {
    Write-Fail "Failed to sign $($failed.Count) artifact(s):"
    $failed | ForEach-Object { Write-Host "  - $_" }
    exit 1
}

Write-Step "All $($Artifacts.Count) artifact(s) signed successfully."
exit 0
