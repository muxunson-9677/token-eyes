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

test("showing the desktop widget restores and focuses its native window", () => {
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  const showBody = widgetWindow.match(
    /pub fn show_desktop_widget[\s\S]*?\n\}\n\n#\[tauri::command\]/u,
  )?.[0];
  assert.ok(showBody, "show_desktop_widget implementation must exist");
  assert.match(showBody, /window\.unminimize\(\)/u);
  assert.match(showBody, /window\.set_focus\(\)/u);
});

test("frontend and Rust use the same prefs argument for widget updates", () => {
  const hook = read("dashboard/src/hooks/use-desktop-widget.ts");
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  assert.match(hook, /invoke\("set_desktop_widget_prefs",\s*\{\s*prefs:\s*next\s*\}\)/u);
  assert.match(
    widgetWindow,
    /pub fn set_desktop_widget_prefs\(\s*app:\s*AppHandle,\s*prefs:\s*WidgetPrefs\)/u,
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
  assert.match(widget, /if \(openMenu \|\| appearanceOpen\) return;/u);
});

test("widget preferences keep project, active-session, usage-plan, and current geometry contracts", () => {
  const hook = read("dashboard/src/hooks/use-desktop-widget.ts");
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  assert.match(hook, /selectedProjectIds/u);
  assert.match(hook, /selectedProjects/u);
  assert.match(hook, /activeSessionWindow/u);
  assert.match(hook, /selectedLimitIds/u);
  assert.match(widgetWindow, /selected_project_ids/u);
  assert.match(widgetWindow, /selected_projects/u);
  assert.match(widgetWindow, /active_session_window/u);
  assert.match(widgetWindow, /selected_limit_ids/u);
  assert.match(widgetWindow, /PREFS_VERSION:\s*u8\s*=\s*11/u);
  assert.match(widgetWindow, /DEFAULT_WIDTH:\s*u32\s*=\s*352/u);
  assert.match(widgetWindow, /DEFAULT_HEIGHT:\s*u32\s*=\s*76/u);
  assert.match(widgetWindow, /DEFAULT_EXPANDED_HEIGHT:\s*u32\s*=\s*360/u);
  assert.match(widgetWindow, /POPOVER_HEIGHT:\s*u32\s*=\s*280/u);
});

test("widget mode changes preserve one fixed expanded geometry", () => {
  const hook = read("dashboard/src/hooks/use-desktop-widget.ts");
  const widget = read("dashboard/src/pages/DesktopWidgetPage.tsx");
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  assert.doesNotMatch(hook, /WIDGET_MODE_EXPANDED_HEIGHTS/u);
  assert.match(widget, /updatePrefs\(\{ mode: nextMode \}\)/u);
  assert.doesNotMatch(widget, /expandedHeight:\s*expandedHeight/u);
  assert.doesNotMatch(widgetWindow, /expanded_height_for_mode/u);
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

test("widget celebration reserves a full transparent halo around the capsule", () => {
  const widgetWindow = read("src-tauri/src/widget_window.rs");
  const css = read("dashboard/src/pages/desktop-widget.css");
  const command = widgetWindow.match(
    /pub fn set_desktop_widget_celebration[\s\S]*?\n\}/u,
  )?.[0];
  assert.ok(command, "set_desktop_widget_celebration must exist");
  assert.match(command, /apply_transient_geometry\(&window, &prefs\)/u);
  assert.match(widgetWindow, /CELEBRATION_PADDING:\s*u32\s*=\s*140/u);
  assert.match(
    css,
    /\.desktop-widget-root\.has-celebration\s*\{\s*padding:\s*calc\(var\(--widget-effect-halo,\s*140px\)\s*\+\s*5px\)\s+var\(--widget-effect-halo,\s*140px\)\s+calc\(var\(--widget-effect-halo,\s*140px\)\s*\+\s*5px\)\s+calc\(var\(--widget-effect-halo,\s*140px\)\s*\+\s*5px\);/u,
  );
});

test("bundled runtime smoke owns a unique temporary home", () => {
  const smoke = read("test/windows-bundled-runtime-smoke.test.cjs");
  assert.match(smoke, /fs\.mkdirSync\(smokeTarget,\s*\{\s*recursive:\s*true\s*\}\)/u);
  assert.match(
    smoke,
    /const smokeHome\s*=\s*fs\.mkdtempSync\(path\.join\(smokeTarget,\s*"runtime-smoke-"\)\)/u,
  );
  assert.doesNotMatch(smoke, /runtime-smoke-\$\{process\.pid\}/u);
  assert.match(smoke, /fs\.rmSync\(smokeHome,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/u);
  const cleanupIndex = smoke.indexOf("t.after(() =>");
  const spawnIndex = smoke.indexOf("spawn(nodeExe");
  assert.ok(
    cleanupIndex >= 0 && spawnIndex >= 0 && cleanupIndex < spawnIndex,
    "cleanup must be registered before spawning the bundled runtime",
  );
});

test("widget visual verification uses real wheel input for scrollable content", () => {
  const visual = read("dashboard/scripts/verify-token-eyes-widget-ui.mjs");
  assert.match(visual, /page\.mouse\.wheel\(0,\s*240\)/u);
  assert.match(visual, /scrollTopAfter\s*>\s*scrollTopBefore/u);
  assert.match(visual, /\["03-projects",\s*"04-limits",\s*"05-models"\]\.includes\(scenario\.name\)/u);
  assert.match(visual, /WIDGET_INTERACTION_AUDIT=PASS/u);
  assert.match(visual, /WIDGET_VISUAL_AUDIT=PASS_24_SCENARIOS/u);
  assert.doesNotMatch(visual, /element\.scrollTop\s*=\s*element\.scrollHeight/u);
});
