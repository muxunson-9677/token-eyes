const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { test } = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const runtimeDir = path.join(repoRoot, "src-tauri", `EmbeddedServer-${config.version}`);
const trackerRoot = path.join(runtimeDir, "tokentracker");

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
  throw lastError || new Error(`bundled backend exited with code ${child.exitCode}`);
}

test("Windows bundled runtime includes its shared registry and starts the local API", async (t) => {
  const nodeExe = path.join(runtimeDir, "node.exe");
  const trackerEntry = path.join(trackerRoot, "bin", "tracker.js");
  const providerRegistry = path.join(trackerRoot, "shared", "provider-capabilities.json");
  assert.ok(fs.existsSync(nodeExe), "run the Tauri Windows build before this smoke test");
  assert.ok(fs.existsSync(trackerEntry), "bundled tracker entry must exist");
  assert.ok(fs.existsSync(providerRegistry), "bundled shared provider registry must exist");

  const port = await findFreePort();
  const smokeTarget = path.join(repoRoot, "src-tauri", "target");
  fs.mkdirSync(smokeTarget, { recursive: true });
  const smokeHome = fs.mkdtempSync(path.join(smokeTarget, "runtime-smoke-"));
  const trackerDataDir = path.join(smokeHome, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDataDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDataDir, "cursors.json"), "{}\n", "utf8");
  let child;
  t.after(() => {
    try {
      if (child?.pid && child.exitCode === null) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      }
    } finally {
      fs.rmSync(smokeHome, { recursive: true, force: true });
    }
  });
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
  child = spawn(nodeExe, ["bin\\tracker.js", "serve", "--no-open", "--no-sync", "--port", String(port)], { cwd: trackerRoot, env, stdio: "pipe", windowsHide: true });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const response = await waitForLocalAuth(port, child).catch((error) => { throw new Error(`${error.message}\nBundled backend stderr:\n${stderr}`); });
  const payload = JSON.parse(response.body);
  assert.ok(payload.protocol_version >= 2, "local API must expose the supported protocol");
  assert.ok(payload.capabilities.includes("provider_api_balance"), "local API must expose provider balances");
});
