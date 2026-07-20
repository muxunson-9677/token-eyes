param(
  [ValidateRange(1, 100)]
  [int]$Runs = 10,
  [string]$ExePath = "",
  [ValidateRange(1, 60)]
  [int]$TimeoutSeconds = 15,
  [int]$VisibleP95MaxMs = 1000,
  [int]$VisibleToInteractiveP95MaxMs = 500,
  [int]$InteractiveP95MaxMs = 1500
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($ExePath)) {
  $ExePath = Join-Path $RepoRoot "src-tauri\target\release\token-eyes.exe"
}
$ExePath = [System.IO.Path]::GetFullPath($ExePath)
$AllowedRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "src-tauri\target\release"))
if (-not $ExePath.StartsWith($AllowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Benchmark executable must stay inside the repository release directory."
}
if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) {
  throw "Token Eyes release executable not found: $ExePath"
}

$samples = @()
for ($index = 1; $index -le $Runs; $index += 1) {
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $ExePath -PassThru
  $visibleMs = $null
  $interactiveMs = $null
  try {
    while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
      if ($process.HasExited) { break }
      $process.Refresh()
      if ($null -eq $visibleMs -and $process.MainWindowHandle -ne 0) {
        $visibleMs = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1)
      }
      if ($null -ne $visibleMs -and $process.Responding) {
        $interactiveMs = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1)
        break
      }
      Start-Sleep -Milliseconds 20
    }
    $samples += [ordered]@{
      run = $index
      pid = $process.Id
      visible_ms = $visibleMs
      interactive_ms = $interactiveMs
      visible_to_interactive_ms = if ($null -ne $interactiveMs -and $null -ne $visibleMs) { [Math]::Round($interactiveMs - $visibleMs, 1) } else { $null }
      exited_early = $process.HasExited
    }
  } finally {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
      $process.WaitForExit(5000) | Out-Null
    }
  }
}

function Get-Percentile([object[]]$Values, [double]$Percentile) {
  $sorted = @($Values | Where-Object { $null -ne $_ } | Sort-Object)
  if ($sorted.Count -eq 0) { return $null }
  $position = [Math]::Ceiling($Percentile * $sorted.Count) - 1
  return $sorted[[Math]::Max(0, [Math]::Min($position, $sorted.Count - 1))]
}

$result = [ordered]@{
  executable = $ExePath
  recorded_at = (Get-Date).ToUniversalTime().ToString("o")
  runs = $Runs
  visible_p50_ms = Get-Percentile ($samples.visible_ms) 0.50
  visible_p95_ms = Get-Percentile ($samples.visible_ms) 0.95
  interactive_p50_ms = Get-Percentile ($samples.interactive_ms) 0.50
  interactive_p95_ms = Get-Percentile ($samples.interactive_ms) 0.95
  visible_to_interactive_p95_ms = Get-Percentile ($samples.visible_to_interactive_ms) 0.95
  samples = $samples
}

$OutputDir = Join-Path $RepoRoot "artifacts\startup"
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$OutputPath = Join-Path $OutputDir "token-eyes-startup.json"
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
$result | ConvertTo-Json -Depth 6

if (@($samples | Where-Object { $null -eq $_.visible_ms -or $null -eq $_.interactive_ms }).Count -gt 0) {
  exit 1
}
if (
  $result.visible_p95_ms -gt $VisibleP95MaxMs -or
  $result.visible_to_interactive_p95_ms -gt $VisibleToInteractiveP95MaxMs -or
  $result.interactive_p95_ms -gt $InteractiveP95MaxMs
) {
  exit 2
}
