const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { copyTreeWithTransientRetry, installLocalTrackerApp } = require("../src/commands/init");

const repoRoot = path.join(__dirname, "..");
const isolatedInitFixture = path.join(__dirname, "fixtures", "init-noop-first-sync.cjs");

function runInitModule(initModulePath, args, env) {
  return spawnSync(process.execPath, [isolatedInitFixture, initModulePath, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

test("dashboard publication retries a transient Windows file lock", async () => {
  let attempts = 0;
  await copyTreeWithTransientRetry("from", "to", {}, {
    copy: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("locked"), { code: "EBUSY" });
    },
    wait: async () => {},
  });
  assert.equal(attempts, 3);
});

test("dashboard publication retries when a concurrent build removes a hashed asset", async () => {
  let attempts = 0;
  await copyTreeWithTransientRetry("from", "to", {}, {
    copy: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("asset replaced during copy"), { code: "ENOENT" });
    },
    wait: async () => {},
  });
  assert.equal(attempts, 2);
});

test("init can rerun from installed local runtime without self-deleting app source", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-init-local-runtime-"));
  const env = {
    ...process.env,
    HOME: tmp,
    USERPROFILE: tmp,
    APPDATA: path.join(tmp, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(tmp, "AppData", "Local"),
    CODEX_HOME: path.join(tmp, ".codex"),
    OPENCODE_CONFIG_DIR: path.join(tmp, ".config", "opencode"),
  };
  delete env.TOKENTRACKER_DEVICE_TOKEN;

  try {
    await fs.mkdir(env.CODEX_HOME, { recursive: true });
    await fs.writeFile(path.join(env.CODEX_HOME, "config.toml"), "# empty\n", "utf8");

    const firstInit = runInitModule(
      path.join(repoRoot, "src", "commands", "init.js"),
      ["--yes", "--no-auth", "--no-open", "--base-url", "https://example.invalid"],
      env,
    );
    assert.equal(
      firstInit.status,
      0,
      `expected first init to succeed\nstdout:\n${firstInit.stdout}\nstderr:\n${firstInit.stderr}`,
    );

    const trackerBinPath = path.join(tmp, ".tokentracker", "tracker", "app", "bin", "tracker.js");
    await fs.stat(trackerBinPath);
    const installedInitPath = path.join(
      tmp,
      ".tokentracker",
      "tracker",
      "app",
      "src",
      "commands",
      "init.js",
    );

    const secondInit = runInitModule(
      installedInitPath,
      ["--yes", "--no-auth", "--no-open", "--base-url", "https://example.invalid"],
      env,
    );
    assert.equal(
      secondInit.status,
      0,
      `expected local runtime init to succeed\nstdout:\n${secondInit.stdout}\nstderr:\n${secondInit.stderr}`,
    );

    await fs.stat(path.join(tmp, ".tokentracker", "tracker", "app", "src", "commands", "init.js"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("installLocalTrackerApp publishes the new dashboard index after retaining served hashed assets", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-runtime-refresh-"));
  try {
    const appDir = path.join(tmp, "app");
    await fs.mkdir(path.join(appDir, "src", "lib"), { recursive: true });
    await fs.mkdir(path.join(appDir, "bin"), { recursive: true });
    await fs.writeFile(path.join(appDir, "src", "lib", "cursor-config.js"), "stale parser\n", "utf8");
    await fs.writeFile(path.join(appDir, "bin", "tracker.js"), "stale bin\n", "utf8");
    const retainedCss = path.join(appDir, "dashboard", "dist", "assets", "value-realtime-pages-stale.css");
    await fs.mkdir(path.dirname(retainedCss), { recursive: true });
    await fs.writeFile(retainedCss, "/* served by an existing dashboard tab */\n", "utf8");

    await installLocalTrackerApp({ appDir });

    const copiedParser = await fs.readFile(path.join(appDir, "src", "lib", "cursor-config.js"), "utf8");
    const marker = JSON.parse(await fs.readFile(path.join(appDir, "package.json"), "utf8"));
    assert.notEqual(copiedParser, "stale parser\n");
    assert.equal(marker.name, "tokentracker-cli");
    assert.equal(typeof marker.version, "string");
    assert.equal(
      await fs.readFile(retainedCss, "utf8"),
      "/* served by an existing dashboard tab */\n",
      "an already-open dashboard can still request its prior hashed CSS after runtime refresh",
    );
    await fs.stat(path.join(appDir, "src", "lib", "codex-context-breakdown.js"));
    await fs.stat(path.join(appDir, "shared", "agent-registry.json"));
    const dashboardIndex = path.join(repoRoot, "dashboard", "dist", "index.html");
    if (await fs.stat(dashboardIndex).then(() => true, () => false)) {
      await fs.stat(path.join(appDir, "dashboard", "dist", "index.html"));
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
