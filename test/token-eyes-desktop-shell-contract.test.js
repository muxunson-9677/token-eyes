const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Token Eyes native shell uses one restoration path for second launch and tray", () => {
  const lib = read("src-tauri/src/lib.rs");
  const tray = read("src-tauri/src/tray.rs");

  assert.match(lib, /tauri_plugin_single_instance::init\([\s\S]*window_control::restore_main_window/);
  assert.match(lib, /window_control::enforce_main_window_title\(app\.handle\(\)\)/);
  assert.match(
    tray,
    /use crate::window_control::\{restore_main_window, APP_DISPLAY_NAME\}/,
  );
  assert.match(tray, /"show" => restore_main_window\(app\)/);
  assert.doesNotMatch(tray, /fn show_main_window/);
});

test("Token Eyes Tauri metadata has no legacy visible product name", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  const cargo = read("src-tauri/Cargo.toml");

  assert.equal(config.productName, "Token Eyes");
  assert.equal(config.app.windows[0].title, "Token Eyes");
  assert.equal(config.identifier, "com.tokeneyes.desktop");
  assert.match(cargo, /description = "Token Eyes - AI Token Usage Tracker Desktop"/);
});
