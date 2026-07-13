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
