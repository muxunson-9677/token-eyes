const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { test } = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const tauriConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const installerPath = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
  `Token Eyes_${tauriConfig.version}_x64-setup.exe`,
);
const evidenceRoot = path.join(repoRoot, "src-tauri", "target", "private-acceptance", "codex-ui");
const enabled = process.env.TOKEN_EYES_PACKAGED_CODEX_UI === "1";
const installerRegistryKeys = [
  String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Token Eyes`,
  String.raw`HKCU\Software\Muxunson\Token Eyes`,
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true, stdio: "pipe" });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited ${code}: ${stderr}`));
    });
  });
}

function registryKeyExists(registryKey) {
  return spawnSync("reg.exe", ["query", registryKey], { windowsHide: true, stdio: "ignore" }).status === 0;
}

async function snapshotInstallerRegistry(root) {
  const snapshots = [];
  for (const [index, registryKey] of installerRegistryKeys.entries()) {
    const existed = registryKeyExists(registryKey);
    const backupPath = path.join(root, `installer-registration-${index}.reg`);
    if (existed) await run("reg.exe", ["export", registryKey, backupPath, "/y"]);
    snapshots.push({ backupPath, existed, registryKey });
  }
  return snapshots;
}

async function restoreInstallerRegistry(snapshots) {
  for (const snapshot of snapshots) {
    if (registryKeyExists(snapshot.registryKey)) {
      await run("reg.exe", ["delete", snapshot.registryKey, "/f"]);
    }
    if (snapshot.existed) await run("reg.exe", ["import", snapshot.backupPath]);
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > 12_120) {
        reject(new Error("no packaged UI debugging port is available"));
        return;
      }
      const server = net.createServer();
      server.once("error", () => tryPort(port + 1));
      server.listen(port, "127.0.0.1", () => {
        server.close((error) => (error ? reject(error) : resolve(port)));
      });
    };
    tryPort(12_111);
  });
}

function cleanEnvironment(home, fixtureBin, debuggingPort) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.VITEST;
  for (const name of Object.keys(env)) {
    if (/(?:auth|cookie|credential|password|secret|token)/iu.test(name)) delete env[name];
  }
  Object.assign(env, {
    USERPROFILE: process.env.USERPROFILE,
    HOME: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    PATH: fixtureBin,
    TOKEN_EYES_PACKAGED_UI_ACCEPTANCE: "1",
    TOKEN_EYES_PACKAGED_UI_HOME: home,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debuggingPort}`,
    WEBVIEW2_USER_DATA_FOLDER: path.join(home, "WebView2"),
  });
  return env;
}

async function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function connectedConfig(sessionId, sessionRef) {
  const now = "2026-08-21T00:00:00.000Z";
  return {
    tokenPlans: [{
      id: "codex-ui-plan",
      source: "codex",
      provider_id: "codex",
      plan_id: "codex_pro_5x",
      plan_label: "Pro 5x",
      quota_kind: "rolling_window",
      quota_unit: "percent",
      total_quota: 100,
      used_quota: 40,
      remaining_quota: 60,
      quota_windows: [],
      expires_at: "",
      refresh_enabled: false,
      refresh_interval_minutes: 60,
      refresh_method: "manual",
      credential_ref: "",
      detection_method: "official_account",
      detection_config: { official_account: { account_binding_id: sessionId } },
      sync_status: "failed",
      last_error_code: "QUOTA_SYNC_FAILED",
      last_error_message: "需要重新登录 Codex 后读取额度",
      last_refresh_status: "failed",
      last_refresh_error: "需要重新登录 Codex 后读取额度",
      last_refresh_at: now,
      next_refresh_at: "",
    }],
    consoleSessions: [{
      id: sessionId,
      provider_id: "codex",
      auth_kind: "official_console_session",
      display_name: "codex / Codex",
      status: "connected",
      session_ref: sessionRef,
      connected_at: now,
      last_verified_at: now,
      last_error_code: "QUOTA_SYNC_FAILED",
      last_error_message: "需要重新登录 Codex 后读取额度",
    }],
  };
}

function seedProfile(home, sessionId, sessionRef, nativeAccountDir) {
  const trackerDir = path.join(home, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "config.json"), `${JSON.stringify(connectedConfig(sessionId, sessionRef), null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(trackerDir, "cursors.json"), "{}\n", "utf8");
  fs.mkdirSync(nativeAccountDir, { recursive: true });
  fs.writeFileSync(path.join(nativeAccountDir, "auth.json"), "{\"legacy_fixture\":true}\n", "utf8");
  return path.join(trackerDir, "config.json");
}

class CdpClient {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(webSocketUrl);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    await this.send("Page.enable");
    await this.send("Runtime.enable");
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "CDP evaluation failed");
    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitForCdp(port, child) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Token Eyes exited before WebView inspection: ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const pages = targets.filter((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
      const target = pages.find((candidate) => {
        const url = String(candidate.url || "");
        return url.length > 0 && !url.includes("/desktop-widget");
      });
      if (target) return target;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  const diagnostic = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$root = Get-CimInstance Win32_Process -Filter \"ProcessId = ${child.pid}\" -ErrorAction SilentlyContinue; $children = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ParentProcessId -eq ${child.pid} -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'remote-debugging-port') }); @{ root = $root | Select-Object ProcessId,Name,ExecutablePath,CommandLine; children = $children | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine } | ConvertTo-Json -Depth 4 -Compress`,
  ], { encoding: "utf8", windowsHide: true });
  throw new Error(`WebView2 debugging endpoint ${port} did not become ready; childExit=${child.exitCode}; processes=${diagnostic.stdout.trim()}; last=${lastError?.message || "none"}`);
}

async function waitForExpression(cdp, expression, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate(`Boolean(${expression})`)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${description}; last=${lastError?.message || "none"}`);
}

async function navigateAfterBootstrap(cdp, pathname) {
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.localStorage.setItem('tokentracker.firstRun.completed.v1', '1');",
  });
  await cdp.send("Runtime.evaluate", {
    expression: "window.localStorage.setItem('tokentracker.firstRun.completed.v1', '1')",
    awaitPromise: true,
  });
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForExpression(
    cdp,
    "window.localStorage.getItem('tokentracker.firstRun.completed.v1') === '1'",
    "the completed first-run state",
  );
  const origin = await cdp.evaluate("window.location.origin");
  await cdp.send("Page.navigate", { url: `${origin}${pathname}` });
}

async function navigateToCodexEditor(cdp) {
  await navigateAfterBootstrap(cdp, "/settings/cost/token-plans/codex-ui-plan/edit");
  await waitForExpression(
    cdp,
    `[...document.querySelectorAll('[data-testid^="detection-"]')].some((element) => [
      'detection-sync-codex',
      'detection-codex-retry',
      'detection-connect-codex',
    ].includes(element.dataset.testid) && !element.disabled)`,
    "an enabled Codex account action",
    30_000,
  );
}

function runScreenInput(action, clientX, clientY, devicePixelRatio, processId) {
  const script = [
    "Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class NativeInput {",
    "  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }",
    "  [DllImport(\"user32.dll\")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);",
    "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "  [DllImport(\"kernel32.dll\")] public static extern uint GetCurrentThreadId();",
    "  [DllImport(\"user32.dll\")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);",
    "  [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);",
    "  [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr SetFocus(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool ClientToScreen(IntPtr hWnd, ref Point point);",
    "  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);",
    "  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);",
    "  public static bool ForceForeground(IntPtr target) {",
    "    IntPtr foreground = GetForegroundWindow();",
    "    uint ignored;",
    "    uint foregroundThread = GetWindowThreadProcessId(foreground, out ignored);",
    "    uint targetThread = GetWindowThreadProcessId(target, out ignored);",
    "    uint currentThread = GetCurrentThreadId();",
    "    if (foregroundThread != currentThread) AttachThreadInput(currentThread, foregroundThread, true);",
    "    if (targetThread != currentThread) AttachThreadInput(currentThread, targetThread, true);",
    "    ShowWindowAsync(target, 9);",
    "    BringWindowToTop(target);",
    "    SetForegroundWindow(target);",
    "    SetActiveWindow(target);",
    "    SetFocus(target);",
    "    if (targetThread != currentThread) AttachThreadInput(currentThread, targetThread, false);",
    "    if (foregroundThread != currentThread) AttachThreadInput(currentThread, foregroundThread, false);",
    "    return GetForegroundWindow() == target;",
    "  }",
    "}",
    "'@",
    "[NativeInput]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null",
    "$p = Get-Process -Id $env:TOKEN_EYES_UI_PID -ErrorAction Stop",
    "$action = $env:TOKEN_EYES_UI_ACTION",
    "if ($action -eq 'focus') {",
    "  [NativeInput]::ForceForeground($p.MainWindowHandle) | Out-Null",
    "  Start-Sleep -Milliseconds 400",
    "}",
    "$foregroundPid = [uint32]0",
    "[NativeInput]::GetWindowThreadProcessId([NativeInput]::GetForegroundWindow(), [ref]$foregroundPid) | Out-Null",
    "if ($foregroundPid -ne $p.Id) { throw 'Token Eyes could not become foreground for the real pointer click' }",
    "if ($action -eq 'focus') { @{ pid = $foregroundPid } | ConvertTo-Json -Compress; exit 0 }",
    "if ($action -ne 'click') { throw 'Unsupported packaged UI input action' }",
    "$origin = [NativeInput+Point]::new()",
    "if (-not [NativeInput]::ClientToScreen($p.MainWindowHandle, [ref]$origin)) { throw 'Token Eyes client origin is unavailable' }",
    "$culture = [System.Globalization.CultureInfo]::InvariantCulture",
    "$clientX = [double]::Parse($env:TOKEN_EYES_UI_CLIENT_X, $culture)",
    "$clientY = [double]::Parse($env:TOKEN_EYES_UI_CLIENT_Y, $culture)",
    "$scale = [double]::Parse($env:TOKEN_EYES_UI_SCALE, $culture)",
    "$screenX = $origin.X + [int][Math]::Round($clientX * $scale)",
    "$screenY = $origin.Y + [int][Math]::Round($clientY * $scale)",
    "[NativeInput]::SetCursorPos($screenX, $screenY) | Out-Null",
    "[NativeInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)",
    "[NativeInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)",
    "@{ x = $screenX; y = $screenY } | ConvertTo-Json -Compress",
  ].join("\n");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      TOKEN_EYES_UI_ACTION: action,
      TOKEN_EYES_UI_PID: String(processId),
      TOKEN_EYES_UI_CLIENT_X: String(clientX),
      TOKEN_EYES_UI_CLIENT_Y: String(clientY),
      TOKEN_EYES_UI_SCALE: String(devicePixelRatio),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

function focusProcessWindow(processId) {
  return runScreenInput("focus", 0, 0, 1, processId);
}

function clickScreenPoint(clientX, clientY, devicePixelRatio, processId) {
  return runScreenInput("click", clientX, clientY, devicePixelRatio, processId);
}

async function clickElementAsUser(cdp, selector, processId) {
  focusProcessWindow(processId);
  const point = await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'center' });
    const rect = element.getBoundingClientRect();
    return {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      devicePixelRatio: window.devicePixelRatio,
    };
  })()`);
  assert.ok(
    point
      && Number.isFinite(point.clientX)
      && Number.isFinite(point.clientY)
      && Number.isFinite(point.devicePixelRatio),
    `missing clickable element ${selector}`,
  );
  return clickScreenPoint(point.clientX, point.clientY, point.devicePixelRatio, processId);
}

async function clickCodexAccountActionAsUser(cdp, processId) {
  const selectors = [
    '[data-testid="detection-sync-codex"]',
    '[data-testid="detection-codex-retry"]',
    '[data-testid="detection-connect-codex"]',
  ];
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    focusProcessWindow(processId);
    const match = await cdp.evaluate(`(() => {
      for (const selector of ${JSON.stringify(selectors)}) {
        const element = document.querySelector(selector);
        if (!element || element.disabled) continue;
        element.scrollIntoView({ block: 'center' });
        const rect = element.getBoundingClientRect();
        return {
          selector,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          devicePixelRatio: window.devicePixelRatio,
        };
      }
      return null;
    })()`);
    if (match) {
      const point = clickScreenPoint(match.clientX, match.clientY, match.devicePixelRatio, processId);
      return { point, selector: match.selector };
    }
    await delay(200);
  }
  throw new Error("the installed Codex editor has no enabled connect, sync, or retry action");
}

function foregroundWindow() {
  const script = [
    "Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class ForegroundWindow {",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "}",
    "'@",
    "$handle = [ForegroundWindow]::GetForegroundWindow()",
    "$pidValue = [uint32]0",
    "[ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$pidValue) | Out-Null",
    "$process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue",
    "@{ pid = $pidValue; name = $process.ProcessName } | ConvertTo-Json -Compress",
  ].join("\n");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

async function waitForBrowserForeground(appPid) {
  const browserNames = new Set(["msedge", "chrome", "firefox", "brave", "opera", "vivaldi"]);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const foreground = foregroundWindow();
    if (foreground.pid !== appPid && browserNames.has(String(foreground.name || "").toLowerCase())) {
      return foreground;
    }
    await delay(300);
  }
  throw new Error("the system browser did not become the foreground application after authorization click");
}

async function capture(cdp, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(filePath, Buffer.from(result.data, "base64"));
}

async function stopProcessTree(child) {
  if (!child?.pid) return;
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await delay(300);
}

function stopProcessesFromInstallDir(installDir) {
  const escaped = installDir.replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${escaped}', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
}

async function launchApp(executable, env) {
  const child = spawn(executable, [], { env, windowsHide: false, stdio: "ignore" });
  const port = Number(env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.match(/(\d+)$/)?.[1]);
  const target = await waitForCdp(port, child);
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  return { cdp, child };
}

async function runSyncJourney({ executable, fixtureBin, passRoot, passName, sessionSuffix }) {
  const home = path.join(passRoot, "sync-profile");
  const sessionId = `${passName}-sync-session`;
  const sessionRef = `token-plan/codex/session/${sessionSuffix}-sync`;
  const nativeAccountDir = path.join(process.env.APPDATA, "com.tokeneyes.desktop", "codex-accounts", `${sessionSuffix}-sync`);
  seedProfile(home, sessionId, sessionRef, nativeAccountDir);
  const port = await findFreePort();
  const env = cleanEnvironment(home, fixtureBin, port);
  const codexLookup = spawnSync("C:\\Windows\\System32\\where.exe", ["codex"], {
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  assert.notEqual(codexLookup.status, 0, "packaged acceptance must not expose codex.exe or codex.cmd");
  assert.equal(await portIsAvailable(1455), true, "OAuth callback port must be free before the click");
  let launched;
  try {
    launched = await launchApp(executable, env);
    try {
      await navigateToCodexEditor(launched.cdp);
    } catch (error) {
      await capture(launched.cdp, path.join(evidenceRoot, `${passName}-startup-failure.png`));
      const diagnostic = await launched.cdp.evaluate(`({
        href: window.location.href,
        firstRunCompleted: window.localStorage.getItem('tokentracker.firstRun.completed.v1'),
        bodyText: document.body?.innerText || '',
      })`);
      fs.writeFileSync(path.join(evidenceRoot, `${passName}-startup-failure.txt`), `${JSON.stringify(diagnostic, null, 2)}\n`, "utf8");
      throw error;
    }
    await capture(launched.cdp, path.join(evidenceRoot, `${passName}-before-sync.png`));
    const initialBodyText = await launched.cdp.evaluate("document.body?.innerText || ''");
    fs.writeFileSync(path.join(evidenceRoot, `${passName}-before-sync.txt`), `${initialBodyText}\n`, "utf8");
    assert.match(
      initialBodyText,
      /授权已失效/u,
      "the installed editor must reconcile a stale local connected record against the missing native authorization",
    );
    assert.equal(
      await launched.cdp.evaluate("Boolean(document.querySelector('[data-testid=\"detection-codex-retry\"]'))"),
      true,
      "the reconciled state must expose the real browser reauthorization action",
    );
    const clickedAction = await clickCodexAccountActionAsUser(launched.cdp, launched.child.pid);
    try {
      await waitForExpression(
        launched.cdp,
        `document.querySelector('[data-testid="detection-codex-login-started"]')`,
        "the built-in OAuth waiting state",
        30_000,
      );
      const listenerDeadline = Date.now() + 10_000;
      while (await portIsAvailable(1455)) {
        if (Date.now() >= listenerDeadline) throw new Error("built-in OAuth did not bind localhost:1455");
        await delay(100);
      }
    } catch (error) {
      await capture(launched.cdp, path.join(evidenceRoot, `${passName}-sync-click-failure.png`));
      const bodyText = await launched.cdp.evaluate("document.body?.innerText || ''");
      fs.writeFileSync(
        path.join(evidenceRoot, `${passName}-sync-click-failure.txt`),
        `${JSON.stringify({ clickedAction, foreground: foregroundWindow(), bodyText, callbackPortAvailable: await portIsAvailable(1455) }, null, 2)}\n`,
        "utf8",
      );
      throw error;
    }
    const browser = await waitForBrowserForeground(launched.child.pid);
    await capture(launched.cdp, path.join(evidenceRoot, `${passName}-after-sync.png`));
    return { browserProcess: browser.name, callbackPort: 1455, codexCliAvailable: false };
  } finally {
    launched?.cdp.close();
    await stopProcessTree(launched?.child);
    fs.rmSync(nativeAccountDir, { recursive: true, force: true });
  }
}

async function runDeleteJourney({ executable, fixtureBin, passRoot, passName, sessionSuffix }) {
  const home = path.join(passRoot, "delete-profile");
  const sessionId = `${passName}-delete-session`;
  const sessionRef = `token-plan/codex/session/${sessionSuffix}-delete`;
  const nativeAccountDir = path.join(process.env.APPDATA, "com.tokeneyes.desktop", "codex-accounts", `${sessionSuffix}-delete`);
  const configPath = seedProfile(home, sessionId, sessionRef, nativeAccountDir);
  const env = cleanEnvironment(home, fixtureBin, await findFreePort());
  let launched;
  try {
    launched = await launchApp(executable, env);
    await navigateToCodexEditor(launched.cdp);
    await capture(launched.cdp, path.join(evidenceRoot, `${passName}-before-delete.png`));
    const clickPoint = await clickElementAsUser(launched.cdp, '[data-testid="detection-disconnect-codex"]', launched.child.pid);
    try {
      await waitForExpression(launched.cdp, `document.querySelector('[data-testid="detection-connect-codex"]') && !document.querySelector('[data-testid="detection-codex-connected"]')`, "the disconnected Codex state", 30_000);
    } catch (error) {
      await capture(launched.cdp, path.join(evidenceRoot, `${passName}-delete-click-failure.png`));
      const bodyText = await launched.cdp.evaluate("document.body?.innerText || ''");
      fs.writeFileSync(
        path.join(evidenceRoot, `${passName}-delete-click-failure.txt`),
        `${JSON.stringify({ clickPoint, foreground: foregroundWindow(), bodyText }, null, 2)}\n`,
        "utf8",
      );
      throw error;
    }
    await launched.cdp.send("Page.reload", { ignoreCache: true });
    await waitForExpression(launched.cdp, `document.querySelector('[data-testid="detection-connect-codex"]') && !document.querySelector('[data-testid="detection-codex-connected"]')`, "the disconnected state after reload", 30_000);
    await capture(launched.cdp, path.join(evidenceRoot, `${passName}-after-delete-reload.png`));
    const stored = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(stored.consoleSessions.some((session) => session.id === sessionId), false, "the local binding must be removed from config.json");
    assert.equal(fs.existsSync(nativeAccountDir), false, "the native Codex account binding must be removed");
  } finally {
    launched?.cdp.close();
    await stopProcessTree(launched?.child);
  }

  const restartEnv = cleanEnvironment(home, fixtureBin, await findFreePort());
  let restarted;
  try {
    restarted = await launchApp(executable, restartEnv);
    await navigateAfterBootstrap(restarted.cdp, "/settings/cost/token-plans/codex-ui-plan/edit");
    await waitForExpression(restarted.cdp, `document.querySelector('[data-testid="detection-connect-codex"]') && !document.querySelector('[data-testid="detection-codex-connected"]')`, "the disconnected state after app restart", 30_000);
    await capture(restarted.cdp, path.join(evidenceRoot, `${passName}-after-delete-restart.png`));
  } finally {
    restarted?.cdp.close();
    await stopProcessTree(restarted?.child);
    fs.rmSync(nativeAccountDir, { recursive: true, force: true });
  }
}

test("the final installed Codex buttons launch browser authorization and complete durable delete twice", {
  skip: enabled ? false : "requires the explicit private packaged-UI acceptance gate",
  timeout: 360_000,
}, async (t) => {
  assert.equal(process.platform, "win32", "the packaged Codex UI acceptance is Windows-only");
  assert.ok(fs.existsSync(installerPath), "build the exact NSIS installer before packaged UI acceptance");
  const existingGui = spawnSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process -Name 'Token Eyes' -ErrorAction SilentlyContinue).Count"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(existingGui.status, 0, existingGui.stderr);
  assert.equal(Number(existingGui.stdout.trim() || 0), 0, "close the currently running Token Eyes GUI before isolated packaged UI acceptance");

  fs.rmSync(evidenceRoot, { recursive: true, force: true });
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-codex-packaged-ui-"));
  const installDir = path.join(root, "app");
  const fixtureBin = path.join(root, "fixture-bin");
  fs.mkdirSync(fixtureBin, { recursive: true });
  const registrySnapshot = await snapshotInstallerRegistry(root);
  t.after(async () => {
    try {
      stopProcessesFromInstallDir(installDir);
    } finally {
      await restoreInstallerRegistry(registrySnapshot);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await run(installerPath, ["/S", `/D=${installDir}`]);
  stopProcessesFromInstallDir(installDir);
  await delay(500);
  const executable = path.join(installDir, "token-eyes.exe");
  assert.ok(fs.existsSync(executable), "the isolated installer must deploy token-eyes.exe");

  const results = [];
  for (const [index, passName] of ["pass-1", "pass-2"].entries()) {
    const passRoot = path.join(root, passName);
    fs.mkdirSync(passRoot, { recursive: true });
    const sessionSuffix = `uiaccept-${process.pid}-${index + 1}`;
    const sync = await runSyncJourney({ executable, fixtureBin, passRoot, passName, sessionSuffix });
    await runDeleteJourney({ executable, fixtureBin, passRoot, passName, sessionSuffix });
    results.push({
      pass: passName,
      browser_process: sync.browserProcess,
      callback_port: sync.callbackPort,
      codex_cli_available: sync.codexCliAvailable,
    });
  }
  fs.writeFileSync(path.join(evidenceRoot, "result.json"), `${JSON.stringify({ installer: path.basename(installerPath), results }, null, 2)}\n`, "utf8");
  assert.deepEqual(results.map((result) => result.callback_port), [1455, 1455]);
  assert.deepEqual(results.map((result) => result.codex_cli_available), [false, false]);
});
