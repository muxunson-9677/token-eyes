"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildWidgetViewModel,
  flattenUsageLimitsPayload,
} = require("../src/lib/widget-view-model");

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

test("widget view model preserves complete quota plans without truncating or splitting windows", () => {
  const limits = Array.from({ length: 11 }, (_, planIndex) => (
    ["7 天", "API Usage", "5 小时"].map((window, windowIndex) => ({
      id: `codex:plan-${String(planIndex).padStart(2, "0")}:window-${windowIndex}`,
      planId: `codex:plan-${String(planIndex).padStart(2, "0")}`,
      agent: "codex",
      provider: "Codex",
      planLabel: `Plan ${String(planIndex).padStart(2, "0")}`,
      accountLabel: `account-${String(planIndex).padStart(2, "0")}`,
      window,
      usedPercent: planIndex,
    }))
  )).flat();

  const dense = buildWidgetViewModel({ limits });
  assert.equal(dense.limits.length, 33, "more than 30 real windows must remain reachable");
  assert.deepEqual(
    dense.limits.map((limit) => `${limit.planId}:${limit.window}`),
    Array.from({ length: 11 }, (_, planIndex) => {
      const planId = `codex:plan-${String(planIndex).padStart(2, "0")}`;
      return ["5 小时", "7 天", "API Usage"].map((window) => `${planId}:${window}`);
    }).flat(),
    "each plan must remain an adjacent, deterministically ordered three-window group",
  );

  assert.deepEqual(buildWidgetViewModel({ limits: [] }).limits, []);
  assert.equal(
    buildWidgetViewModel({ agent: "cursor", limits: limits.slice(0, 2) }).limits.length,
    0,
    "disabled agents must not leak quota windows into the selected agent",
  );
  assert.equal(
    buildWidgetViewModel({ limits: limits.slice(0, 2) }).limits.length,
    2,
    "small plans must not be padded or dropped",
  );
});

test("widget view model keeps quota reset and plan expiry as independent facts", () => {
  const resetAt = "2026-08-20T03:33:00.000Z";
  const expiresAt = "2026-09-01T00:00:00.000Z";
  const plans = [
    {
      id: "both",
      source: "codex",
      expires_at: expiresAt,
      quota_windows: [{ kind: "rolling_5_hour", reset_at: resetAt }],
    },
    {
      id: "reset-only",
      source: "codex",
      quota_windows: [{ kind: "rolling_5_hour", reset_at: resetAt }],
    },
    { id: "expires-only", source: "codex", expires_at: expiresAt },
    { id: "neither", source: "codex" },
  ];

  const limits = flattenUsageLimitsPayload(null, plans);
  assert.deepEqual(
    Object.fromEntries(limits.map((limit) => [limit.planId, {
      resetAt: limit.resetAt,
      expiresAt: limit.expiresAt,
    }])),
    {
      "codex:both": { resetAt, expiresAt },
      "codex:reset-only": { resetAt, expiresAt: null },
      "codex:expires-only": { resetAt: null, expiresAt },
      "codex:neither": { resetAt: null, expiresAt: null },
    },
  );
});

test("widget view model rejects ambiguous dates and normalizes offset ISO timestamps", () => {
  const [offset, numeric, nonzeroNumeric, positiveSigned, negativeSigned, invalid, empty]
    = flattenUsageLimitsPayload(null, [
    {
      id: "offset",
      source: "codex",
      expires_at: "2026-09-01T08:00:00+08:00",
      quota_windows: [{ kind: "rolling_5_hour", reset_at: "2026-08-20T11:33:00+08:00" }],
    },
    {
      id: "numeric",
      source: "codex",
      expires_at: "0",
      quota_windows: [{ kind: "rolling_5_hour", reset_at: "0" }],
    },
    { id: "nonzero-numeric", source: "codex", expires_at: "1787196799" },
    { id: "positive-signed", source: "codex", expires_at: "+1" },
    { id: "negative-signed", source: "codex", expires_at: "-1" },
    {
      id: "invalid",
      source: "codex",
      expires_at: "not-a-date",
      quota_windows: [{ kind: "rolling_5_hour", reset_at: "not-a-date" }],
    },
    {
      id: "empty",
      source: "codex",
      expires_at: "",
      quota_windows: [{ kind: "rolling_5_hour", reset_at: "" }],
    },
  ]);

  assert.deepEqual(
    { resetAt: offset.resetAt, expiresAt: offset.expiresAt },
    {
      resetAt: "2026-08-20T03:33:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
    },
  );
  for (const limit of [numeric, nonzeroNumeric, positiveSigned, negativeSigned, invalid, empty]) {
    assert.equal(limit.resetAt, null);
    assert.equal(limit.expiresAt, null);
  }
  assert.deepEqual(
    buildWidgetViewModel({
      limits: [{
        id: "ambiguous",
        planId: "codex:ambiguous",
        agent: "codex",
        resetAt: "0",
        expiresAt: "0",
      }],
    }).limits.map(({ resetAt, expiresAt }) => ({ resetAt, expiresAt })),
    [{ resetAt: null, expiresAt: null }],
  );
});

test("widget view model accepts only contractual ISO and calendar dates", () => {
  const limits = flattenUsageLimitsPayload(null, [
    { id: "date-only", source: "codex", expires_at: "2028-02-29" },
    { id: "zulu", source: "codex", expires_at: "2026-08-20T03:33:00.123Z" },
    { id: "offset-leap", source: "codex", expires_at: "2028-02-29T23:30:00.250+01:30" },
    { id: "bad-calendar", source: "codex", expires_at: "2026-02-30" },
    { id: "bad-calendar-time", source: "codex", expires_at: "2026-02-30T03:33:00Z" },
    { id: "bad-month", source: "codex", expires_at: "2026-13-01" },
    { id: "us-date", source: "codex", expires_at: "08/20/2026" },
    { id: "month-name", source: "codex", expires_at: "August 20 2026" },
    { id: "local-space", source: "codex", expires_at: "2026-08-20 03:33:00" },
    { id: "no-zone", source: "codex", expires_at: "2026-08-20T03:33:00" },
    { id: "overflow", source: "codex", expires_at: "2026-08-20T25:00:00Z" },
    { id: "overflow-offset", source: "codex", expires_at: "2026-08-20T03:33:00+14:01" },
  ]);
  const expiryByPlan = Object.fromEntries(limits.map((limit) => [limit.planId, limit.expiresAt]));

  assert.equal(expiryByPlan["codex:date-only"], "2028-02-29T00:00:00.000Z");
  assert.equal(expiryByPlan["codex:zulu"], "2026-08-20T03:33:00.123Z");
  assert.equal(expiryByPlan["codex:offset-leap"], "2028-02-29T22:00:00.250Z");
  for (const planId of [
    "bad-calendar",
    "bad-calendar-time",
    "bad-month",
    "us-date",
    "month-name",
    "local-space",
    "no-zone",
    "overflow",
    "overflow-offset",
  ]) {
    assert.equal(expiryByPlan[`codex:${planId}`], null);
  }
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
  const installedSmoke = read("test/windows-installed-runtime-smoke.test.cjs");
  assert.match(smoke, /fs\.mkdirSync\(smokeTarget,\s*\{\s*recursive:\s*true\s*\}\)/u);
  assert.match(
    smoke,
    /const smokeHome\s*=\s*fs\.mkdtempSync\(path\.join\(smokeTarget,\s*"runtime-smoke-"\)\)/u,
  );
  assert.doesNotMatch(smoke, /runtime-smoke-\$\{process\.pid\}/u);
  assert.doesNotMatch(smoke, /\.\.\.process\.env/u);
  assert.doesNotMatch(installedSmoke, /const env\s*=\s*\{\s*\.\.\.process\.env/u);
  for (const name of [
    "AGENTDATA",
    "CLAUDE_HOME",
    "CODEX_HOME",
    "OPENCODE_HOME",
    "TOKENTRACKER_AGENTDATA_ROOTS",
    "XDG_DATA_HOME",
  ]) {
    const deletion = new RegExp(`delete env\\.${name}`);
    assert.match(smoke, deletion, `bundled smoke must remove ${name}`);
    assert.match(installedSmoke, deletion, `installed smoke must remove ${name}`);
  }
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
  assert.match(visual, /scenario\.name === "04-limits" \? 30/u);
  assert.match(visual, /stateAudit\.planCount !== 10/u);
  assert.match(visual, /lastRowVisible/u);
  assert.match(visual, /fixedGeometryBefore/u);
  assert.match(visual, /fixedGeometryAfter/u);
  assert.match(visual, /fixedToolbarVisible/u);
  assert.match(visual, /fixedRegionOutsideScroll/u);
  assert.match(visual, /fixedGeometryStable/u);
  assert.match(visual, /planIndex >= 8/u);
  assert.match(visual, /planIndex === 9/u);
  assert.match(visual, /重置时间不可用/u);
  assert.match(visual, /missingResetCount !== 6/u);
  assert.match(visual, /expiryOnlyFactsValid/u);
  assert.match(visual, /expiryOnlyText\.startsWith\("有效期 "\)/u);
  assert.match(visual, /expiryOnlyText\.includes\(" · "\)/u);
  assert.match(visual, /neitherFactsValid/u);
  assert.match(visual, /page\.waitForFunction\([\s\S]*widget-expanded-limit-plan[\s\S]*widget-limit-row/u);
  assert.doesNotMatch(visual, /readyText[\s\S]*67%/u);
  assert.match(visual, /WIDGET_INTERACTION_AUDIT=PASS/u);
  assert.match(visual, /WIDGET_VISUAL_AUDIT=PASS_24_SCENARIOS/u);
  assert.doesNotMatch(visual, /element\.scrollTop\s*=\s*element\.scrollHeight/u);
});
