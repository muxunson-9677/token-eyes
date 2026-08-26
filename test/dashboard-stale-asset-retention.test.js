const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const dashboardDir = path.join(repositoryRoot, "dashboard");
const retainedAsset = path.join(dashboardDir, "dist", "assets", `stale-build-${process.pid}.js`);

test("dashboard rebuild removes a stale hashed asset", () => {
  fs.mkdirSync(path.dirname(retainedAsset), { recursive: true });
  fs.writeFileSync(retainedAsset, "export default 'stale build';\n", "utf8");

  try {
    execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
      cwd: dashboardDir,
      stdio: "pipe",
      env: { ...process.env, NO_COLOR: "1", npm_config_loglevel: "error" },
    });
    assert.equal(fs.existsSync(retainedAsset), false);
  } finally {
    fs.rmSync(retainedAsset, { force: true });
  }
});
