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

test("compact widget menus temporarily expand the native window and stay vertical", () => {
  const widget = read("dashboard/src/pages/DesktopWidgetPage.tsx");
  const css = read("dashboard/src/pages/desktop-widget.css");
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  const menuCss = css.match(/\.widget-menu\s*\{[\s\S]*?\n\}/u)?.[0];
  assert.match(widget, /data-menu-layout="vertical"/u);
  assert.match(widgetWindow, /set_desktop_widget_popover/u);
  assert.ok(menuCss, "widget menu CSS must exist");
  assert.doesNotMatch(menuCss, /grid-auto-flow:\s*column/u);
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

test("desktop widget grants native dragging and starts it only from non-interactive surfaces", () => {
  const capability = read("src-tauri/capabilities/default.json");
  const widget = read("dashboard/src/pages/DesktopWidgetPage.tsx");
  assert.match(capability, /core:window:allow-start-dragging/u);
  assert.match(widget, /startDragging/u);
  assert.match(widget, /closest\(/u);
  assert.match(widget, /button|input|menu|slider/u);
});

test("desktop widget persists a project selection preference", () => {
  const hook = read("dashboard/src/hooks/use-desktop-widget.ts");
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  assert.match(hook, /selectedProjectIds/u);
  assert.match(hook, /selectedProjects/u);
  assert.match(hook, /activeSessionWindow/u);
  assert.match(widgetWindow, /selected_project_ids/u);
  assert.match(widgetWindow, /selected_projects/u);
  assert.match(widgetWindow, /active_session_window/u);
  assert.match(widgetWindow, /PREFS_VERSION:\s*u8\s*=\s*5/u);
});

test("saving widget preferences notifies the already-open floating WebView", () => {
  const hook = read("dashboard/src/hooks/use-desktop-widget.ts");
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  assert.match(hook, /token-eyes:desktop-widget-prefs-changed/u);
  assert.match(
    widgetWindow,
    /window\.dispatchEvent\(new Event\('token-eyes:desktop-widget-prefs-changed'\)\)/u,
  );
});

test("appearance controls render as a document-level popover instead of covering the capsule", () => {
  const widget = read("dashboard/src/pages/DesktopWidgetPage.tsx");
  const css = read("dashboard/src/pages/desktop-widget.css");
  assert.match(widget, /createPortal\([\s\S]*widget-appearance/u);
  assert.match(css, /\.widget-appearance\s*\{[\s\S]*position:\s*fixed/u);
});
