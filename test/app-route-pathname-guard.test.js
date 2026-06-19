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
});

test("App.jsx redirects hidden product routes to dashboard", () => {
  const appPath = path.join(repoRoot, "dashboard/src/App.jsx");
  const source = fs.readFileSync(appPath, "utf8");
  assert.equal(source.includes("isMvpHiddenProductPath"), true, "hidden route guard should exist");
  assert.equal(source.includes('<Navigate to="/dashboard" replace />'), true, "hidden routes should redirect to dashboard");
  for (const route of ["/leaderboard", "/limits", "/skills", "/widgets", "/ip-check", "/wrapped"]) {
    assert.equal(source.includes(`normalizedPath === "${route}"`) || source.includes(`normalizedPath === '${route}'`), true, `${route} should be covered by hidden route logic`);
  }
});

test("Sidebar exposes only Dashboard, Spend, and Settings nav items", () => {
  const sidebarPath = path.join(repoRoot, "dashboard/src/ui/components/Sidebar.jsx");
  const source = fs.readFileSync(sidebarPath, "utf8");
  for (const route of ["/dashboard", "/spend", "/settings"]) {
    assert.equal(source.includes(`to: "${route}"`), true, `${route} nav item should exist`);
  }
  for (const route of ["/leaderboard", "/limits", "/skills", "/widgets", "/ip-check"]) {
    assert.equal(source.includes(`to: "${route}"`), false, `${route} nav item should be hidden`);
  }
});
