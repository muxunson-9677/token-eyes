!macro NSIS_HOOK_PREINSTALL
  InitPluginsDir
  FileOpen $0 "$PLUGINSDIR\token-eyes-stop-running.ps1" w
  FileWrite $0 "param([string]$$InstallDir)$\r$\n"
  FileWrite $0 "if ([string]::IsNullOrWhiteSpace($$InstallDir) -or -not (Test-Path -LiteralPath $$InstallDir)) { exit 0 }$\r$\n"
  FileWrite $0 "$$targets = @($\r$\n"
  FileWrite $0 "  [System.IO.Path]::GetFullPath((Join-Path $$InstallDir 'token-eyes.exe'))$\r$\n"
  FileWrite $0 " ) + @(Get-ChildItem -LiteralPath $$InstallDir -Directory -Filter 'EmbeddedServer-*' -ErrorAction SilentlyContinue | ForEach-Object { [System.IO.Path]::GetFullPath((Join-Path $$_.FullName 'node.exe')) })$\r$\n"
  FileWrite $0 "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |$\r$\n"
  FileWrite $0 "  Where-Object { $$_.ExecutablePath -and ($$targets -contains [System.IO.Path]::GetFullPath($$_.ExecutablePath)) } |$\r$\n"
  FileWrite $0 "  ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\r$\n"
  FileWrite $0 "Start-Sleep -Milliseconds 600$\r$\n"
  FileClose $0
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\token-eyes-stop-running.ps1" "$INSTDIR"'
!macroend
