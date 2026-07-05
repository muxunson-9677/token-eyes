# ──────────────────────────────────────────────
# run-production-audit.ps1
#
# Runs production npm audits for root and dashboard, and cargo audit for
# the Tauri Rust dependency tree. Fail-closed: any high/critical
# vulnerability (npm) or any cargo-audit vulnerability fails the script.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/release/run-production-audit.ps1 `
#     -RepoRoot "." [-SkipCargoAudit]
#
# Exit codes:
#   0  — all audits clean
#   1  — any audit found vulnerabilities
# ──────────────────────────────────────────────
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [switch]$SkipCargoAudit
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "==> $msg" }
function Write-Fail($msg) { Write-Host "FAIL: $msg" -ForegroundColor Red }

$failed = $false

# ── 1. Root production audit ──
Write-Step "Root npm audit --omit=dev --audit-level=high"
& npm --prefix $RepoRoot audit --omit=dev --audit-level=high 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Root production audit FAILED (exit $LASTEXITCODE)"
    $failed = $true
} else {
    Write-Step "Root production audit clean"
}

# ── 2. Dashboard production audit ──
Write-Step "Dashboard npm audit --omit=dev --audit-level=high"
& npm --prefix (Join-Path $RepoRoot 'dashboard') audit --omit=dev --audit-level=high 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Dashboard production audit FAILED (exit $LASTEXITCODE)"
    $failed = $true
} else {
    Write-Step "Dashboard production audit clean"
}

# ── 3. cargo audit ──
if (-not $SkipCargoAudit) {
    $cargoLock = Join-Path $RepoRoot 'src-tauri\Cargo.lock'
    Write-Step "cargo audit --file $cargoLock"
    # cargo audit writes progress ("Fetching advisory database") to stderr.
    # Under $ErrorActionPreference = 'Stop', PowerShell wraps stderr lines as
    # ErrorRecords and aborts on the first one — before $LASTEXITCODE is set.
    # Temporarily relax to 'Continue' so we can capture output and decide on
    # the real exit code. Same pattern as bundle-runtime.ps1 npm ci handling.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $cargoOutput = & cargo audit --file $cargoLock 2>&1 | Out-String
    $cargoExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    Write-Host $cargoOutput
    if ($cargoExit -ne 0) {
        Write-Fail "cargo audit FAILED (exit $cargoExit) — vulnerabilities found"
        $failed = $true
    } else {
        Write-Step "cargo audit clean (0 vulnerabilities)"
    }
}

if ($failed) {
    Write-Fail "One or more audits failed — blocking release upload"
    exit 1
}

Write-Step "All production audits passed."
exit 0
