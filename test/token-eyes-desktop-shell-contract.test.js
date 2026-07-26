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
    /tauri_plugin_single_instance::init\(\|app, _argv, _cwd\| \{\s*window_control::restore_main_window_for_trigger\(\s*app,\s*window_control::SINGLE_INSTANCE_RESTORE_TRIGGER,\s*\);\s*\}\)/,
  );
  assert.match(lib, /window_control::enforce_main_window_title\(app\.handle\(\)\)/);
  assert.match(lib, /#\[path = "commands\.rs"\]\s*mod commands;/);
  assert.match(
    lib,
    /window_control::should_minimize_to_tray\(\s*window\.label\(\),\s*prefs\.minimize_to_tray_on_close,?\s*\)/,
  );
  assert.match(
    tray,
    /use crate::window_control::\{\s*restore_main_window_for_trigger, RestoreTrigger, APP_DISPLAY_NAME,\s*\}/,
  );
  assert.match(tray, /RestoreMainWindow => \{\s*restore_main_window_for_trigger\(app, RestoreTrigger::TrayMenu\)/);
  assert.match(
    tray,
    /restore_main_window_for_trigger\(\s*tray\.app_handle\(\),\s*RestoreTrigger::TrayClick,\s*\)/,
  );
  assert.equal((tray.match(/restore_main_window_for_trigger\(/g) || []).length, 2);
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
