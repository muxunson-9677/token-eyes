const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

// 03-发布配置与可复现收口: 所有正式版本源必须一致。
// F7 反例: src-tauri/tauri.conf.json 曾为 0.1.0，与 package.json 0.54.0 不一致，
// 导致 MSI/NSIS 安装包元数据仍显示 0.1.0。本测试在版本不一致时必须失败。

const ROOT = path.join(__dirname, "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function extractCargoVersion(tomlText) {
  const m = tomlText.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  assert.ok(m, "Cargo.toml must have [package] version");
  return m[1];
}

function extractCsprojVersion(csprojText) {
  const m = csprojText.match(/<Version>\s*([^<]+?)\s*<\/Version>/);
  assert.ok(m, "TokenTrackerWin.csproj must have <Version>");
  return m[1];
}

function extractMarketingVersions(yamlText) {
  const matches = [...yamlText.matchAll(/MARKETING_VERSION:\s*"([^"]+)"/g)];
  assert.ok(
    matches.length >= 2,
    "project.yml must have at least two MARKETING_VERSION entries (App + Widget)"
  );
  return matches.map((m) => m[1]);
}

test("package.json version is the canonical release version", () => {
  const pkg = readJson("package.json");
  assert.ok(pkg.version, "package.json must declare a version");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "version must be semver X.Y.Z");
});

test("F7: src-tauri/tauri.conf.json version matches package.json", () => {
  const pkg = readJson("package.json");
  const tauri = readJson("src-tauri/tauri.conf.json");
  assert.ok(tauri.version, "tauri.conf.json must declare a version");
  assert.equal(
    tauri.version,
    pkg.version,
    `tauri.conf.json version (${tauri.version}) must match package.json (${pkg.version}) — ` +
      `MSI/NSIS installer metadata reads version from tauri.conf.json`
  );
});

test("src-tauri/Cargo.toml version matches package.json", () => {
  const pkg = readJson("package.json");
  const cargo = extractCargoVersion(readText("src-tauri/Cargo.toml"));
  assert.equal(
    cargo,
    pkg.version,
    `Cargo.toml version (${cargo}) must match package.json (${pkg.version})`
  );
});

test("TokenTrackerBar/project.yml MARKETING_VERSION matches package.json (both targets)", () => {
  const pkg = readJson("package.json");
  const versions = extractMarketingVersions(
    readText("TokenTrackerBar/project.yml")
  );
  for (const v of versions) {
    assert.equal(
      v,
      pkg.version,
      `project.yml MARKETING_VERSION (${v}) must match package.json (${pkg.version})`
    );
  }
});

test("TokenTrackerWin/TokenTrackerWin.csproj Version matches package.json", () => {
  const pkg = readJson("package.json");
  const csproj = extractCsprojVersion(
    readText("TokenTrackerWin/TokenTrackerWin.csproj")
  );
  assert.equal(
    csproj,
    pkg.version,
    `csproj Version (${csproj}) must match package.json (${pkg.version})`
  );
});

test("all formal version sources are identical", () => {
  const pkg = readJson("package.json");
  const tauri = readJson("src-tauri/tauri.conf.json");
  const cargo = extractCargoVersion(readText("src-tauri/Cargo.toml"));
  const csproj = extractCsprojVersion(
    readText("TokenTrackerWin/TokenTrackerWin.csproj")
  );
  const marketing = extractMarketingVersions(
    readText("TokenTrackerBar/project.yml")
  );
  const all = [pkg.version, tauri.version, cargo, csproj, ...marketing];
  const unique = [...new Set(all)];
  assert.equal(unique.length, 1, () => {
    const detail = {
      "package.json": pkg.version,
      "tauri.conf.json": tauri.version,
      "Cargo.toml": cargo,
      "TokenTrackerWin.csproj": csproj,
      "project.yml MARKETING_VERSION": marketing,
    };
    return `all version sources must be identical, found: ${JSON.stringify(detail, null, 2)}`;
  });
});
