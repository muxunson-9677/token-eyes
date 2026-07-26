const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
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
  const smokeHome = path.join(repoRoot, "src-tauri", "target", `runtime-smoke-${process.pid}`);
  fs.mkdirSync(smokeHome, { recursive: true });
  const env = { ...process.env, USERPROFILE: smokeHome, HOME: smokeHome, APPDATA: path.join(smokeHome, "AppData", "Roaming"), LOCALAPPDATA: path.join(smokeHome, "AppData", "Local") };
  const child = spawn(nodeExe, ["bin\\tracker.js", "serve", "--no-open", "--no-sync", "--port", String(port)], { cwd: trackerRoot, env, stdio: "pipe", windowsHide: true });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill(); });

  const response = await waitForLocalAuth(port, child).catch((error) => { throw new Error(`${error.message}\nBundled backend stderr:\n${stderr}`); });
  const payload = JSON.parse(response.body);
  assert.ok(payload.protocol_version >= 2, "local API must expose the supported protocol");
  assert.ok(payload.capabilities.includes("provider_api_balance"), "local API must expose provider balances");
});
