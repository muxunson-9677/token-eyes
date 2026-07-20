const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const pagePath = path.join(__dirname, "..", "dashboard", "src", "pages", "DashboardPage.jsx");

test("DashboardPage refreshes local usage in the background on first open and window focus", () => {
  const source = fs.readFileSync(pagePath, "utf8");
  assert.match(source, /handleAutoRefresh\(\);/);
  assert.match(source, /window\.addEventListener\("focus", refreshOnFocus\)/);
  assert.match(source, /window\.removeEventListener\("focus", refreshOnFocus\)/);
});
