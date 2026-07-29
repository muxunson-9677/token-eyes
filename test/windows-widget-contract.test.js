"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  assert.equal(fs.existsSync(absolutePath), true, `${relativePath} must exist`);
  return fs.readFileSync(absolutePath, "utf8");
}

test("Windows ships one independent desktop-widget route and Tauri window module", () => {
  const app = read("dashboard/src/App.jsx");
  assert.match(app, /\/desktop-widget/u);
  assert.equal(
    fs.existsSync(path.join(ROOT, "dashboard/src/pages/DesktopWidgetPage.tsx")),
    true,
  );
  assert.equal(fs.existsSync(path.join(ROOT, "src-tauri/src/widget_window.rs")), true);
});

test("widget reset acknowledgement has no automatic dismissal or navigation side effect", () => {
  const widget = read("dashboard/src/pages/DesktopWidgetPage.tsx");
  assert.doesNotMatch(widget, /setTimeout\s*\([^)]*(dismiss|acknowledge)/u);
  assert.doesNotMatch(widget, /(navigate|location\.(assign|href)|open)\s*\([^)]*reset/u);
  assert.match(widget, /acknowledgePendingReset/u);
});

test("widget implementation keeps a single vertical content scroll region", () => {
  const widget = read("dashboard/src/pages/DesktopWidgetPage.tsx");
  const regions = widget.match(/data-widget-scroll-region/g) || [];
  assert.equal(regions.length, 1);
});

test("compact widget menus stay inside the native 72px window", () => {
  const widget = read("dashboard/src/pages/DesktopWidgetPage.tsx");
  const css = read("dashboard/src/pages/desktop-widget.css");
  assert.match(widget, /data-menu-kind/u);
  assert.match(css, /@media\s*\(max-height:\s*120px\)/u);
  assert.match(css, /grid-auto-flow:\s*column/u);
});

test("native widget loads its application route directly instead of rewriting about:blank", () => {
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  assert.match(
    widgetWindow,
    /WebviewUrl::App\("desktop-widget"\.into\(\)\)/u,
  );
  assert.doesNotMatch(widgetWindow, /\.initialization_script\(/u);
});

test("desktop widget is preloaded during app setup before frontend commands can show it", () => {
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  const restoreBody = widgetWindow.match(
    /pub fn restore_if_visible[\s\S]*?\n\}\n\npub fn toggle_desktop_widget/u,
  )?.[0];
  assert.ok(restoreBody, "restore_if_visible implementation must exist");
  assert.doesNotMatch(restoreBody, /if !prefs\.visible\s*\{\s*return;/u);
  assert.match(restoreBody, /widget_window\(app,\s*&prefs\)/u);
});

test("frontend and Rust use the same prefs argument for widget updates", () => {
  const hook = read("dashboard/src/hooks/use-desktop-widget.ts");
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  assert.match(hook, /invoke\("set_desktop_widget_prefs",\s*\{\s*prefs:\s*next\s*\}\)/u);
  assert.match(
    widgetWindow,
    /pub fn set_desktop_widget_prefs\(\s*app:\s*AppHandle,\s*prefs:\s*WidgetPrefs,/u,
  );
});

test("widget preload cannot block the UI while the local backend starts", () => {
  const commands = read("src-tauri/src/commands.rs");
  assert.match(commands, /pub async fn local_server_status\(/u);
  assert.match(commands, /spawn_blocking\(move \|\|/u);
});

test("expanding the widget reapplies clamped monitor geometry", () => {
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  const setter = widgetWindow.match(
    /pub fn set_desktop_widget_prefs[\s\S]*?\n\}\n\n#\[tauri::command\]/u,
  )?.[0];
  assert.ok(setter, "widget preference setter must exist");
  assert.match(setter, /apply_geometry\(&window,\s*&prefs\)/u);
});
