const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Token Eyes native shell uses one restoration path for second launch and tray", () => {
  const lib = read("src-tauri/src/lib.rs");
  const tray = read("src-tauri/src/tray.rs");

  assert.match(
    lib,
    /tauri_plugin_single_instance::init\(\|app, _argv, _cwd\| \{\s*window_control::restore_main_window\(app\);\s*\}\)/,
  );
  assert.match(lib, /window_control::enforce_main_window_title\(app\.handle\(\)\)/);
  assert.match(lib, /#\[path = "commands\.rs"\]\s*mod commands;/);
  assert.match(
    lib,
    /window_control::should_minimize_to_tray\(\s*window\.label\(\),\s*prefs\.minimize_to_tray_on_close,?\s*\)/,
  );
  assert.match(
    tray,
    /use crate::window_control::\{restore_main_window, APP_DISPLAY_NAME\}/,
  );
  assert.match(tray, /"show" => restore_main_window\(app\)/);
  assert.match(tray, /restore_main_window\(tray\.app_handle\(\)\)/);
  assert.equal((tray.match(/restore_main_window\(/g) || []).length, 2);
  assert.doesNotMatch(tray, /fn show_main_window/);
});

test("Token Eyes Tauri metadata has no legacy visible product name", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  const windowsConfig = JSON.parse(read("src-tauri/tauri.windows.conf.json"));
  const cargo = read("src-tauri/Cargo.toml");

  assert.equal(config.productName, "Token Eyes");
  assert.equal(config.app.windows[0].title, "Token Eyes");
  assert.equal(config.identifier, "com.tokeneyes.desktop");
  assert.equal(windowsConfig.app.windows[0].title, "Token Eyes");
  assert.equal(windowsConfig.app.windows[0].visible, true);
  assert.match(cargo, /description = "Token Eyes - AI Token Usage Tracker Desktop"/);
});

test("Token Eyes Windows main window uses native system window controls", () => {
  const windowsConfig = JSON.parse(read("src-tauri/tauri.windows.conf.json"));
  const mainWindow = windowsConfig.app.windows.find((window) => window.label === "main");

  assert.equal(mainWindow.decorations, true);
  assert.equal(mainWindow.visible, true);
});

test("reference screenshot verification can isolate one image during the required per-image loop", () => {
  const verifier = read("dashboard/scripts/verify-p0-desktop-ux.mjs");

  assert.match(verifier, /TOKEN_EYES_REFERENCE_SCENARIO/);
  assert.match(verifier, /referenceScenarioFilter/);
});

test("reference screenshot verification enforces reference geometry instead of reporting a visual pass", () => {
  const verifier = read("dashboard/scripts/verify-p0-desktop-ux.mjs");
  assert.match(verifier, /referenceGeometry/);
  assert.match(verifier, /STRUCTURE_PASS/);
  assert.doesNotMatch(verifier, /referenceMode[\s\S]{0,120}status:\s*"PASS"/);
});

test("reference screenshot verification uses the reference fixture instead of product mock data", () => {
  const verifier = read("dashboard/scripts/verify-p0-desktop-ux.mjs");

  assert.match(verifier, /if \(!referenceMode && !scenario\.staleAfterLoad\) params\.set\("mock", "1"\)/);
  for (const sample of [
    "10_251_000_000",
    "gpt-5.6-sol",
    "deepseek-v4-pro",
    "claude-3.5-sonnet",
    "hermes: 1_517_148_000",
    'collection_status: "connected_no_precise_tokens"',
  ]) {
    assert.match(verifier, new RegExp(sample.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

