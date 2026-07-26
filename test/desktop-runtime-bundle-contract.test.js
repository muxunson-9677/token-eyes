"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const MAC_BUNDLER = path.join(REPO_ROOT, "TokenTrackerBar", "scripts", "bundle-node.sh");
const WINDOWS_BUNDLER = path.join(REPO_ROOT, "src-tauri", "scripts", "bundle-runtime.ps1");

test("desktop bundlers include shared provider metadata and smoke the bundled CLI", () => {
  const mac = fs.readFileSync(MAC_BUNDLER, "utf8");
  assert.match(mac, /cp -R "\$REPO_ROOT\/shared" "\$TT_DIR\/shared"/);
  assert.match(mac, /provider-capabilities\.json/);
  assert.match(mac, /tracker\.js" --help/);
  assert.match(mac, /package-lock\.json/);
  assert.match(mac, /npm ci --omit=dev --omit=optional --ignore-scripts/);
  assert.match(mac, /dashboard\/dist\/ not found[\s\S]*exit 1/);

  const windows = fs.readFileSync(WINDOWS_BUNDLER, "utf8");
  assert.match(windows, /Copy-Item \(Join-Path \$RepoRoot 'shared'\) \(Join-Path \$ttDir 'shared'\) -Recurse/);
  assert.match(windows, /provider-capabilities\.json/);
  assert.match(windows, /tracker\.js'\) --help/);
});

test("an offline desktop-style source layout starts the CLI with its shared manifest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-bundle-contract-"));
  try {
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "bin", "tracker.js"), path.join(root, "bin", "tracker.js"));
    fs.cpSync(path.join(REPO_ROOT, "src"), path.join(root, "src"), { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, "shared"), path.join(root, "shared"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(root, "package.json"));

    const result = spawnSync(process.execPath, [path.join(root, "bin", "tracker.js"), "--help"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: path.join(REPO_ROOT, "node_modules") },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Token Eyes|tokentracker/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});