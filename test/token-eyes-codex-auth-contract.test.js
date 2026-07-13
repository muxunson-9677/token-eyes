const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Codex auth uses the official app-server and never an embedded WebView", () => {
  const appServer = read("src-tauri/src/codex_app_server.rs");
  const session = read("src-tauri/src/codex_session.rs");
  const lib = read("src-tauri/src/lib.rs");
  const nativeSource = `${appServer}\n${session}`;

  assert.match(lib, /mod codex_app_server;/);
  assert.match(nativeSource, /account\/login\/start/);
  assert.match(nativeSource, /account\/login\/completed/);
  assert.match(nativeSource, /account\/read/);
  assert.match(nativeSource, /account\/rateLimits\/read/);
  assert.match(session, /sync_codex_console_quota/);
  assert.match(session, /discard_codex_pending_session/);
  assert.match(read("dashboard/src/lib/api.ts"), /syncCodexConsoleQuota/);
  assert.doesNotMatch(nativeSource, /WebviewWindowBuilder/);
  assert.doesNotMatch(nativeSource, /backend-api\/wham\/usage/);
  assert.doesNotMatch(nativeSource, /document\.cookie|localStorage|sessionStorage/);
});
