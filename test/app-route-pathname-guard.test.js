const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { transform } = require("esbuild");

const repoRoot = path.join(__dirname, "..");

async function parseDashboardFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  await transform(source, {
    loader: "jsx",
    sourcefile: relativePath,
  });
}

test("App.jsx parses without duplicate identifier errors", async () => {
  await assert.doesNotReject(parseDashboardFile("dashboard/src/App.jsx"));
});

test("App.jsx keeps MVP routes reachable", () => {
  const appPath = path.join(repoRoot, "dashboard/src/App.jsx");
  const source = fs.readFileSync(appPath, "utf8");
  assert.equal(source.includes('"/dashboard"'), true, "/dashboard route should exist");
  assert.equal(source.includes('"/spend"'), true, "/spend route should exist");
  assert.equal(source.includes('"/settings"'), true, "/settings route should exist");
  assert.equal(source.includes("SpendPage"), true, "SpendPage should be referenced");
  assert.equal(source.includes("SettingsPage"), true, "SettingsPage should be referenced");
  assert.equal(source.includes('"/spend/value-comparison"'), true, "retired value comparison path should remain as an explicit redirect");
  assert.equal(source.includes("ValueComparisonPage"), false, "retired value comparison page must not remain importable");
  assert.equal(source.includes('"/spend/realtime-sessions"'), true, "realtime sessions route should exist");
});

test("App.jsx keeps only unrequested product routes hidden while keeping leaderboard and widgets reachable", () => {
  const appPath = path.join(repoRoot, "dashboard/src/App.jsx");
  const source = fs.readFileSync(appPath, "utf8");
  assert.equal(source.includes("isMvpHiddenProductPath"), true, "unrequested routes must stay behind the MVP redirect");
  for (const route of ["/limits", "/skills", "/ip-check", "/wrapped"]) {
    assert.equal(source.includes(`normalizedPath === "${route}"`) || source.includes(`normalizedPath === '${route}'`), true, `${route} should remain routable`);
  }
  assert.equal(source.includes('normalizedPath === "/leaderboard"'), true, "/leaderboard route should remain reachable");
});

test("Sidebar excludes unrequested product routes", () => {
  const sidebarPath = path.join(repoRoot, "dashboard/src/ui/components/Sidebar.jsx");
  const source = fs.readFileSync(sidebarPath, "utf8");
  // v2.0 IA: two-level navigation. Dashboard stays flat; Spend/Settings use sub-routes.
  assert.equal(source.includes('to: "/dashboard"'), true, "/dashboard nav item should exist");
  assert.equal(source.includes('to: "/leaderboard"'), true, "/leaderboard nav item should exist");
  assert.equal(source.includes('to: "/spend/'), true, "/spend/* nav item should exist (v2.0 IA sub-routes)");
  assert.equal(source.includes('to: "/settings/'), true, "/settings/* nav item should exist (v2.0 IA sub-routes)");
  for (const route of ["/limits", "/skills", "/ip-check"]) {
    assert.equal(source.includes(`to: "${route}"`), false, `${route} must not be exposed in navigation`);
  }
  assert.equal(source.includes('to: "/widgets"'), true, "/widgets must remain available as pending macOS-only functionality");
});

test("Sidebar imports router APIs used by layout", () => {
  const sidebarPath = path.join(repoRoot, "dashboard/src/ui/components/Sidebar.jsx");
  const source = fs.readFileSync(sidebarPath, "utf8");
  const routerImport = source.match(/import\s+\{([^}]+)\}\s+from\s+["']react-router-dom["']/);
  assert.ok(routerImport, "Sidebar.jsx should import router APIs from react-router-dom");
  const importedNames = routerImport[1].split(",").map((name) => name.trim());
  assert.equal(importedNames.includes("Link"), true, "Sidebar.jsx should import Link");
  assert.equal(importedNames.includes("useLocation"), true, "Sidebar.jsx should import useLocation");
});

test("Sidebar mobile brand uses the shared Token Eyes name", () => {
  const sidebarPath = path.join(repoRoot, "dashboard/src/ui/components/Sidebar.jsx");
  const source = fs.readFileSync(sidebarPath, "utf8");
  assert.equal(source.includes('copy("shared.app_name")'), true, "mobile brand should use shared app name copy");
  assert.equal(source.includes("Token Tracker"), false, "Sidebar should not expose the old brand name");
});
