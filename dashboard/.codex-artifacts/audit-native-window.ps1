param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,
  [Parameter(Mandatory = $true)]
  [string]$ScreenshotPath
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class TokenEyesNativeWindowAudit {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")]
  public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
}
"@

[TokenEyesNativeWindowAudit]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$process = Get-Process token-eyes -ErrorAction Stop |
  Where-Object { $_.Path -eq $resolvedExecutable -and $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1
if (-not $process) { throw "The requested Token Eyes native window is not running." }

$handle = [IntPtr]$process.MainWindowHandle
$style = [TokenEyesNativeWindowAudit]::GetWindowLongPtr($handle, -16).ToInt64()
$flags = [ordered]@{
  caption = (($style -band 0x00C00000) -eq 0x00C00000)
  systemMenu = (($style -band 0x00080000) -ne 0)
  minimizeBox = (($style -band 0x00020000) -ne 0)
  maximizeBox = (($style -band 0x00010000) -ne 0)
  resizableFrame = (($style -band 0x00040000) -ne 0)
}

[TokenEyesNativeWindowAudit]::PostMessage($handle, 0x0112, [IntPtr]0xF020, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 450
$minimized = [TokenEyesNativeWindowAudit]::IsIconic($handle)
[TokenEyesNativeWindowAudit]::ShowWindow($handle, 9) | Out-Null
Start-Sleep -Milliseconds 300
[TokenEyesNativeWindowAudit]::PostMessage($handle, 0x0112, [IntPtr]0xF030, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 450
$maximized = [TokenEyesNativeWindowAudit]::IsZoomed($handle)
[TokenEyesNativeWindowAudit]::ShowWindow($handle, 9) | Out-Null
Start-Sleep -Milliseconds 450
[TokenEyesNativeWindowAudit]::SetForegroundWindow($handle) | Out-Null
[TokenEyesNativeWindowAudit]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, 0x0043) | Out-Null
Start-Sleep -Milliseconds 300

$rect = New-Object TokenEyesNativeWindowAudit+RECT
[TokenEyesNativeWindowAudit]::GetWindowRect($handle, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
$bitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
[TokenEyesNativeWindowAudit]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 0x0043) | Out-Null

[ordered]@{
  executable = $resolvedExecutable
  pid = $process.Id
  title = $process.MainWindowTitle
  nativeStyle = $flags
  minimizeTransitionWorked = $minimized
  maximizeTransitionWorked = $maximized
  restoredAfterAudit = -not [TokenEyesNativeWindowAudit]::IsIconic($handle) -and -not [TokenEyesNativeWindowAudit]::IsZoomed($handle)
  visibleCaptureWorked = $true
  bounds = [ordered]@{ left = $rect.Left; top = $rect.Top; width = $width; height = $height }
} | ConvertTo-Json -Depth 4
