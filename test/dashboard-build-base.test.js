require("./helpers/home-shim.cjs");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

async function resolveDashboardConfig(singleFile) {
  const previous = process.env.TOKENTRACKER_SINGLE_FILE;
  if (singleFile) process.env.TOKENTRACKER_SINGLE_FILE = "1";
  else delete process.env.TOKENTRACKER_SINGLE_FILE;

  try {
    const { default: createConfig } = await import("../dashboard/vite.config.js");
    return createConfig({ mode: "production" });
  } finally {
    if (previous === undefined) delete process.env.TOKENTRACKER_SINGLE_FILE;
    else process.env.TOKENTRACKER_SINGLE_FILE = previous;
  }
}

test("normal dashboard build uses root-relative assets for direct nested routes", async () => {
  const config = await resolveDashboardConfig(false);

  assert.equal(config.base, "/");
  assert.equal(
    new URL(`${config.base}assets/main.js`, "http://127.0.0.1:7680/spend/usage").pathname,
    "/assets/main.js",
  );
});

test("single-file contest build retains relative asset semantics", async () => {
  const config = await resolveDashboardConfig(true);

  assert.equal(config.base, "./");
});

test("dashboard public icon references resolve to shipped files", () => {
  const dashboardDir = path.resolve(__dirname, "..", "dashboard");
  const html = fs.readFileSync(path.join(dashboardDir, "index.html"), "utf8");
  const iconHrefs = [...html.matchAll(/<link\s+rel="(?:apple-touch-)?icon"\s+href="\/([^"]+)"/g)]
    .map((match) => match[1]);

  assert.ok(iconHrefs.length > 0);
  for (const href of iconHrefs) {
    assert.ok(
      fs.existsSync(path.join(dashboardDir, "public", href)),
      `dashboard/public/${href} must exist`,
    );
  }
});