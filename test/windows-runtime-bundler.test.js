const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const BUNDLER_PATH = path.join(__dirname, "..", "src-tauri", "scripts", "bundle-runtime.ps1");

test("Windows runtime bundler hashes files without PowerShell-only Get-FileHash", () => {
  const source = fs.readFileSync(BUNDLER_PATH, "utf8");

  assert.doesNotMatch(source, /Get-FileHash/);
  assert.match(source, /function Get-Sha256Hex/);
  assert.match(source, /System\.Security\.Cryptography\.SHA256/);
  assert.match(source, /Get-Sha256Hex \$zipPath/);
  assert.match(source, /Get-Sha256Hex \(Join-Path \$EmbedDir 'node\.exe'\)/);
});
