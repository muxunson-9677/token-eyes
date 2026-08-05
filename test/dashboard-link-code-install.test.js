const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pagePath = path.join(__dirname, "..", "dashboard", "src", "pages", "DashboardPage.jsx");
const detailsPath = path.join(
  __dirname,
  "..",
  "dashboard",
  "src",
  "ui",
  "dashboard",
  "components",
  "DataDetails.jsx",
);

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("Dashboard overview does not wire the removed initialization command card", () => {
  const src = readFile(pagePath);
  const details = readFile(detailsPath);
  assert.ok(!src.includes("dashboard.install.cmd.init"), "init command must stay out of the overview");
  assert.ok(!src.includes("installInitCmd"), "init command state must stay removed");
  assert.ok(!details.includes("<code"), "empty detail state must not render a command card");
});
