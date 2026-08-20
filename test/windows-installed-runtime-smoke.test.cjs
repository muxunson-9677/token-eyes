const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { test } = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const cargoToml = fs.readFileSync(path.join(repoRoot, "src-tauri", "Cargo.toml"), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
const installerPath = path.join(repoRoot, "src-tauri", "target", "release", "bundle", "nsis", `Token Eyes_${config.version}_x64-setup.exe`);
const installerRegistryKeys = [
  String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Token Eyes`,
  String.raw`HKCU\Software\Muxunson\Token Eyes`,
];
const runIsolatedInstallerSmoke = process.env.TOKEN_EYES_ISOLATED_INSTALLER_SMOKE === "1";

function readInstallerRegistryState() {
  return installerRegistryKeys.map((registryKey) => {
    const result = spawnSync("reg.exe", ["query", registryKey], {
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      registryKey,
      status: result.status,
      stdout: String(result.stdout || "").replace(/\r\n/g, "\n").trim(),
    };
  });
}

const installerRegistryBeforeSmoke = readInstallerRegistryState();

test("Tauri bundles the runtime matching the app version", () => {
  const expectedRuntimeResource = `EmbeddedServer-${config.version}/**/*`;
  assert.ok(
    config.bundle.resources.includes(expectedRuntimeResource),
    `tauri.conf.json must bundle ${expectedRuntimeResource}`,
  );
});

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true, stdio: "pipe" });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}: ${stderr}`)));
  });
}

function installerRegistryExists(registryKey) {
  return spawnSync("reg.exe", ["query", registryKey], {
    windowsHide: true,
    stdio: "ignore",
  }).status === 0;
}

async function snapshotInstallerRegistry(installRoot) {
  const snapshots = [];
  for (const [index, registryKey] of installerRegistryKeys.entries()) {
    const existed = installerRegistryExists(registryKey);
    const backupPath = path.join(installRoot, `token-eyes-installer-registration-${index}.reg`);
    if (existed) {
      await run("reg.exe", ["export", registryKey, backupPath, "/y"]);
    }
    snapshots.push({ backupPath, existed, registryKey });
  }
  return snapshots;
}

async function restoreInstallerRegistry(snapshots) {
  for (const snapshot of snapshots) {
    if (installerRegistryExists(snapshot.registryKey)) {
      await run("reg.exe", ["delete", snapshot.registryKey, "/f"]);
    }
    if (snapshot.existed) {
      await run("reg.exe", ["import", snapshot.backupPath]);
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestLocalAuth(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/api/local-auth", headers: { Origin: "http://tauri.localhost" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body }));
    });
    request.setTimeout(500, () => request.destroy(new Error("request timed out")));
    request.once("error", reject);
  });
}

async function waitForLocalAuth(port, child) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await requestLocalAuth(port);
      if (response.statusCode === 200) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error(`installed bundled backend exited with code ${child.exitCode}`);
}

async function stopRuntimeProcesses(runtimeDir) {
  const script = [
    "$runtimeDir = [Environment]::GetEnvironmentVariable('TOKEN_EYES_SMOKE_RUNTIME_DIR')",
    "$deadline = [DateTime]::UtcNow.AddSeconds(10)",
    "do {",
    "  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |",
    "    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($runtimeDir, [System.StringComparison]::OrdinalIgnoreCase) })",
    "  $processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    "  if ($processes.Count -gt 0) { Start-Sleep -Milliseconds 100 }",
    "} while ($processes.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)",
    "if ($processes.Count -gt 0) { throw \"installed runtime processes did not exit\" }",
  ].join("\n");
  await run("powershell.exe", ["-NoProfile", "-Command", script], {
    env: { ...process.env, TOKEN_EYES_SMOKE_RUNTIME_DIR: runtimeDir },
  });
}

async function removeInstallRoot(installRoot) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      fs.rmSync(installRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!error || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
      await delay(250);
    }
  }
  throw lastError;
}

test("Windows NSIS installer deploys and starts the versioned bundled runtime", {
  skip: runIsolatedInstallerSmoke ? false : "requires an isolated Windows user or VM",
}, async (t) => {
  const workflowHeadSha = String(process.env.TOKEN_EYES_GIT_SHA || "").trim().toLowerCase();
  assert.match(workflowHeadSha, /^[0-9a-f]{40}$/, "isolated installer smoke requires the workflow Git SHA");
  assert.equal(config.version, cargoVersion, "Tauri config and CARGO_PKG_VERSION must match");
  assert.ok(fs.existsSync(installerPath), "build the NSIS installer before this smoke test");
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-installer-smoke-"));
  const installDir = path.join(installRoot, "app");
  const runtimeDir = path.join(installDir, `EmbeddedServer-${config.version}`);
  const registrySnapshot = await snapshotInstallerRegistry(installRoot);
  t.after(async () => {
    try {
      await stopRuntimeProcesses(runtimeDir);
    } finally {
      try {
        await restoreInstallerRegistry(registrySnapshot);
      } finally {
        await removeInstallRoot(installRoot);
      }
    }
  });

  await run(installerPath, ["/S", `/D=${installDir}`]);

  const trackerRoot = path.join(runtimeDir, "tokentracker");
  const nodeExe = path.join(runtimeDir, "node.exe");
  const trackerEntry = path.join(trackerRoot, "bin", "tracker.js");
  const manifest = path.join(runtimeDir, "runtime-manifest.json");
  const localApiSource = path.join(trackerRoot, "src", "lib", "local-api.js");
  const agentRegistry = path.join(trackerRoot, "shared", "agent-registry.json");
  assert.ok(fs.existsSync(nodeExe), "installer must deploy the versioned node runtime");
  assert.ok(fs.existsSync(trackerEntry), "installer must deploy tracker.js under the versioned runtime");
  assert.ok(fs.existsSync(manifest), "installer must deploy the runtime manifest");
  const buildManifest = JSON.parse(fs.readFileSync(manifest, "utf8").replace(/^\uFEFF/, ""));
  assert.equal(buildManifest.app_version, config.version, "installed manifest version must match Tauri config");
  assert.equal(buildManifest.app_version, cargoVersion, "installed manifest version must match CARGO_PKG_VERSION");
  assert.equal(buildManifest.head_sha, workflowHeadSha, "installed manifest SHA must match the workflow checkout");
  assert.ok(Number.isFinite(Date.parse(buildManifest.built_at_utc)), "installed manifest must record a valid build time");
  assert.match(buildManifest.built_at_utc, /Z$/, "installed manifest build time must be UTC");
  assert.ok(fs.existsSync(agentRegistry), "installer must deploy the canonical agent registry");
  const registryProbe = spawnSync(nodeExe, [
    "-e",
    "const a=require('./src/lib/agent-adapters');const r=require('./shared/agent-registry.json');process.stdout.write(JSON.stringify({adapters:a.AGENT_ADAPTERS.length,identities:a.listAgentUsageIdentities().length,canonical:r.adapters.length,kiroCli:a.getAgentAdapter('kiro-cli').queueSource}))",
  ], { cwd: trackerRoot, encoding: "utf8", windowsHide: true });
  assert.equal(registryProbe.status, 0, registryProbe.stderr);
  assert.deepEqual(JSON.parse(registryProbe.stdout), {
    adapters: 28,
    identities: 27,
    canonical: 28,
    kiroCli: "kiro",
  });
  assert.doesNotMatch(
    fs.readFileSync(localApiSource, "utf8"),
    /shouldScanDefaultWindowsDrives/,
    "installed runtime must not contain the removed undefined Windows-drive helper",
  );

  const port = await findFreePort();
  const smokeHome = path.join(installRoot, "home");
  const trackerDataDir = path.join(smokeHome, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDataDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDataDir, "cursors.json"), "{}\n", "utf8");
  const env = Object.fromEntries(
    ["COMSPEC", "OS", "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE", "SystemRoot", "WINDIR"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  Object.assign(env, {
    USERPROFILE: smokeHome,
    HOME: smokeHome,
    APPDATA: path.join(smokeHome, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(smokeHome, "AppData", "Local"),
    TEMP: smokeHome,
    TMP: smokeHome,
  });
  delete env.NODE_TEST_CONTEXT;
  delete env.VITEST;
  delete env.AGENTDATA;
  delete env.ANTIGRAVITY_HOME;
  delete env.CLAUDE_HOME;
  delete env.CODE_HOME;
  delete env.CODEBUDDY_HOME;
  delete env.CODEX_HOME;
  delete env.COPILOT_OTEL_FILE_EXPORTER_PATH;
  delete env.CURSOR_HOME;
  delete env.GEMINI_HOME;
  delete env.GROK_HOME;
  delete env.KIMI_CODE_HOME;
  delete env.KIMI_HOME;
  delete env.OPENCLAW_CONFIG_PATH;
  delete env.OPENCLAW_HOME;
  delete env.OPENCLAW_STATE_DIR;
  delete env.OPENCODE_HOME;
  delete env.TOKENTRACKER_AGENTDATA_ROOTS;
  delete env.TOKENTRACKER_GROK_HOME;
  delete env.TOKENTRACKER_HERMES_HOME;
  delete env.TOKENTRACKER_OPENCLAW_HOME;
  delete env.TRAE_HOME;
  delete env.WORKBUDDY_HOME;
  delete env.XDG_CONFIG_HOME;
  delete env.XDG_DATA_HOME;
  const child = spawn(nodeExe, ["bin\\tracker.js", "serve", "--no-open", "--no-sync", "--port", String(port)], { cwd: trackerRoot, env, stdio: "pipe", windowsHide: true });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const response = await waitForLocalAuth(port, child).catch((error) => { throw new Error(`${error.message}\nInstalled backend stderr:\n${stderr}`); });
  const payload = JSON.parse(response.body);
  assert.ok(payload.protocol_version >= 2, "installed runtime must expose the supported local API");
});

test("Windows installer smoke restores the pre-existing installer registration", {
  skip: runIsolatedInstallerSmoke ? false : "installer smoke did not run in this user session",
}, () => {
  assert.deepEqual(readInstallerRegistryState(), installerRegistryBeforeSmoke);
});
