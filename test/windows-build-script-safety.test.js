const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

test("local Tauri build does not silently install the app", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.ok(
    !pkg.scripts["tauri:build"].includes("tauri:verify-installer"),
    "tauri:build must not run the installed-runtime smoke test because NSIS mutates the user's install registration",
  );
});

test("Windows release keeps installed-runtime verification explicit", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "release-windows.yml"),
    "utf8",
  );

  assert.match(
    pkg.scripts["tauri:build:ci"] || "",
    /tauri:verify-installer/,
    "tauri:build:ci must retain installed-runtime verification",
  );
  assert.match(
    workflow,
    /npm run tauri:build:ci/,
    "release-windows.yml must use the explicit CI build path",
  );
});
