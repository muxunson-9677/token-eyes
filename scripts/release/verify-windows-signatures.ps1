# ──────────────────────────────────────────────
# verify-windows-signatures.ps1
#
# Verifies that Token Eyes Windows artifacts (EXE / MSI / NSIS) have
# valid Authenticode signatures with a trusted publisher and timestamp.
# Generates a SHA256SUMS file after verification.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/release/verify-windows-signatures.ps1 `
#     -ReleaseRoot "src-tauri/target/release" `
#     -OutputSha256 "src-tauri/target/release/SHA256SUMS" `
#     [-ExpectedSubject "CN=Token Eyes, O=..., ..."]
#
# Exit codes:
#   0  — all artifacts Valid + SHA256SUMS written
#   1  — any artifact NotSigned/HashMismatch/NotTrusted/etc.
# ──────────────────────────────────────────────
param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseRoot,

    [Parameter(Mandatory = $true)]
    [string]$OutputSha256,

    [string]$ExpectedSubject = $null
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "==> $msg" }
function Write-Fail($msg) { Write-Host "FAIL: $msg" -ForegroundColor Red }

# ── 1. Resolve artifacts ──
$exePath = Join-Path $ReleaseRoot 'token-eyes.exe'
$msiFiles = Get-ChildItem (Join-Path $ReleaseRoot 'bundle\msi\*.msi') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$nsisFiles = Get-ChildItem (Join-Path $ReleaseRoot 'bundle\nsis\*-setup.exe') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

$artifacts = @()
if (Test-Path $exePath) { $artifacts += $exePath } else { Write-Fail "Missing EXE: $exePath"; exit 1 }
if ($msiFiles) { $artifacts += $msiFiles.FullName } else { Write-Fail "No MSI found in $ReleaseRoot\bundle\msi"; exit 1 }
if ($nsisFiles) { $artifacts += $nsisFiles.FullName } else { Write-Fail "No NSIS found in $ReleaseRoot\bundle\nsis"; exit 1 }

Write-Step "Verifying $($artifacts.Count) artifacts"

# ── 2. Verify each signature ──
$failed = @()
$shaLines = @()

foreach ($artifact in $artifacts) {
    Write-Step "Checking: $artifact"
    $sig = Get-AuthenticodeSignature $artifact

    $status = $sig.Status
    $statusMsg = $sig.StatusMessage
    $signerCN = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '(none)' }
    $timestamperCN = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Subject } else { '(none)' }
    $notAfter = if ($sig.SignerCertificate) { $sig.SignerCertificate.NotAfter } else { '(none)' }

    Write-Host "  Status:          $status"
    Write-Host "  StatusMessage:   $statusMsg"
    Write-Host "  Signer:          $signerCN"
    Write-Host "  Timestamper:     $timestamperCN"
    Write-Host "  NotAfter:        $notAfter"

    # Fail-closed: status must be Valid
    if ($status -ne 'Valid') {
        Write-Fail "Signature NOT Valid for $artifact (status=$status)"
        $failed += $artifact
    }

    # Reject self-signed (Subject == Issuer)
    if ($sig.SignerCertificate -and $sig.SignerCertificate.Subject -eq $sig.SignerCertificate.Issuer) {
        Write-Fail "Self-signed certificate rejected for $artifact"
        $failed += $artifact
    }

    # Timestamper required (proves signature was valid at signing time)
    if (-not $sig.TimeStamperCertificate) {
        Write-Fail "No timestamp on $artifact — signature will expire"
        $failed += $artifact
    }

    # Optional: verify expected publisher subject
    if ($ExpectedSubject -and $signerCN -notlike "*$ExpectedSubject*") {
        Write-Fail "Publisher subject mismatch on $artifact"
        Write-Fail "  Expected to contain: $ExpectedSubject"
        Write-Fail "  Got: $signerCN"
        $failed += $artifact
    }

    # Compute SHA256 for SHA256SUMS
    $hash = (Get-FileHash $artifact -Algorithm SHA256).Hash.ToLower()
    $basename = Split-Path $artifact -Leaf
    $shaLines += "$hash  $basename"
}

if ($failed.Count -gt 0) {
    Write-Fail "$($failed.Count) artifact(s) failed signature verification"
    exit 1
}

# ── 3. Write SHA256SUMS ──
$shaDir = Split-Path $OutputSha256 -Parent
if (-not (Test-Path $shaDir)) { New-Item -ItemType Directory -Force -Path $shaDir | Out-Null }
$shaLines | Set-Content -Path $OutputSha256 -Encoding UTF8
Write-Step "SHA256SUMS written to $OutputSha256"
Get-Content $OutputSha256 | ForEach-Object { Write-Host "  $_" }

Write-Step "All $($artifacts.Count) artifacts have Valid signatures."
exit 0
