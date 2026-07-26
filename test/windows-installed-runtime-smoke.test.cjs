const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test } = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const installerPath = path.join(repoRoot, "src-tauri", "target", "release", "bundle", "nsis", `Token Eyes_${config.version}_x64-setup.exe`);

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
    "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |",
    "  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($runtimeDir, [System.StringComparison]::OrdinalIgnoreCase) } |",
    "  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join("\n");
  await run("powershell.exe", ["-NoProfile", "-Command", script], {
    env: { ...process.env, TOKEN_EYES_SMOKE_RUNTIME_DIR: runtimeDir },
  });
}

test("Windows NSIS installer deploys and starts the versioned bundled runtime", async (t) => {
  assert.ok(fs.existsSync(installerPath), "build the NSIS installer before this smoke test");
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-installer-smoke-"));
  const installDir = path.join(installRoot, "app");

  await run(installerPath, ["/S", `/D=${installDir}`]);

  const runtimeDir = path.join(installDir, `EmbeddedServer-${config.version}`);
  const trackerRoot = path.join(runtimeDir, "tokentracker");
  const nodeExe = path.join(runtimeDir, "node.exe");
  const trackerEntry = path.join(trackerRoot, "bin", "tracker.js");
  const manifest = path.join(runtimeDir, "runtime-manifest.json");
  assert.ok(fs.existsSync(nodeExe), "installer must deploy the versioned node runtime");
  assert.ok(fs.existsSync(trackerEntry), "installer must deploy tracker.js under the versioned runtime");
  assert.ok(fs.existsSync(manifest), "installer must deploy the runtime manifest");

  const port = await findFreePort();
  const smokeHome = path.join(installRoot, "home");
  const env = { ...process.env, USERPROFILE: smokeHome, HOME: smokeHome, APPDATA: path.join(smokeHome, "AppData", "Roaming"), LOCALAPPDATA: path.join(smokeHome, "AppData", "Local") };
  const child = spawn(nodeExe, ["bin\\tracker.js", "serve", "--no-open", "--no-sync", "--port", String(port)], { cwd: trackerRoot, env, stdio: "pipe", windowsHide: true });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    await stopRuntimeProcesses(runtimeDir);
    fs.rmSync(installRoot, { recursive: true, force: true, maxRetries: 30, retryDelay: 250 });
  });

  const response = await waitForLocalAuth(port, child).catch((error) => { throw new Error(`${error.message}\nInstalled backend stderr:\n${stderr}`); });
  const payload = JSON.parse(response.body);
  assert.ok(payload.protocol_version >= 2, "installed runtime must expose the supported local API");
});
