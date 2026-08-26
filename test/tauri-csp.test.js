const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("packaged Tauri CSP permits bundled data fonts without broadening script access", () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "src-tauri", "tauri.conf.json"),
    "utf8",
  ));
  const csp = config.app?.security?.csp || "";

  assert.match(csp, /font-src 'self' data:/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});
