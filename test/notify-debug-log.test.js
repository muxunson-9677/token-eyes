const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const cp = require("node:child_process");
const { test } = require("node:test");

test("notify spawns the installed local sync without a cloud device token", () => {
  const vm = require("node:vm");
  const { buildNotifyHandler } = require("../src/commands/init");
  const trackerDir = path.join(os.tmpdir(), "local-notify-contract");
  const launches = [];
  const files = new Map();
  const handler = buildNotifyHandler({ trackerDir });
  const notifyPath = path.join(trackerDir, "notify.cjs");
  const context = {
    require(name) {
      if (name === "node:fs") return {
        mkdirSync() {}, writeFileSync(file, value) { files.set(file, value); },
        existsSync(file) { return file.endsWith(path.join("bin", "tracker.js")); },
        readFileSync(file) { if (files.has(file)) return files.get(file); throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      };
      if (name === "node:child_process") return { spawn(exe, args) { launches.push({ exe, args }); return { on() {}, unref() {} }; } };
      return require(name);
    },
    process: { argv: [process.execPath, notifyPath, "--source=codex"], execPath: process.execPath, env: {}, exit() {} },
    __filename: notifyPath,
  };
  vm.runInNewContext(handler, context);
  assert.equal(launches.length, 1);
  assert.deepEqual(Array.from(launches[0].args).slice(1), ["sync", "--auto", "--from-notify"]);
  assert.equal(launches[0].args.includes("--drain"), false);
  vm.runInNewContext(handler, { ...context });
  assert.equal(launches.length, 1, "the existing 20-second throttle still applies");
});

async function runNotify(notifyPath, env) {
  await new Promise((resolve, reject) => {
    const child = cp.execFile(process.execPath, [notifyPath, "--source=codex"], { env }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function runInit(env) {
  const root = path.resolve(__dirname, "..");
  const fixture = path.join(__dirname, "fixtures", "init-noop-first-sync.cjs");
  const initModule = path.join(root, "src", "commands", "init.js");

  await new Promise((resolve, reject) => {
    cp.execFile(
      process.execPath,
      [
        fixture,
        initModule,
        "--yes",
        "--no-auth",
        "--no-open",
        "--base-url",
        "https://example.invalid",
      ],
      { env },
      (err) => {
        if (err) return reject(err);
        resolve();
      },
    );
  });
}

async function rmWithRetry(target, retries = 3) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (err) {
      lastErr = err;
      if (!err || err.code !== "ENOTEMPTY") throw err;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastErr;
}

async function setupInitEnv() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-notify-debug-"));
  const codexHome = path.join(tmp, ".codex");
  await fs.mkdir(codexHome, { recursive: true });

  const env = {
    ...process.env,
    HOME: tmp,
    USERPROFILE: tmp,
    APPDATA: path.join(tmp, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(tmp, "AppData", "Local"),
    CODEX_HOME: codexHome,
    GEMINI_HOME: path.join(tmp, ".gemini"),
    CLAUDE_CONFIG_DIR: path.join(tmp, ".claude"),
    OPENCODE_CONFIG_DIR: path.join(tmp, ".config", "opencode"),
  };
  delete env.TOKENTRACKER_DEVICE_TOKEN;

  await runInit(env);

  const notifyPath = path.join(tmp, ".tokentracker", "bin", "notify.cjs");
  const trackerDir = path.join(tmp, ".tokentracker", "tracker");
  const debugLogPath = path.join(trackerDir, "notify.debug.jsonl");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(path.join(trackerDir, "config.json"), "{}", "utf8");

  return {
    tmp,
    env,
    notifyPath,
    trackerDir,
    debugLogPath,
    cleanup: async () => {
      await rmWithRetry(tmp);
    },
  };
}

test("notify debug log is gated and capped by env settings", async () => {
  const gatedContext = await setupInitEnv();
  try {
    await assert.rejects(fs.stat(gatedContext.debugLogPath), /ENOENT/);
    await runNotify(gatedContext.notifyPath, gatedContext.env);
    await assert.rejects(fs.stat(gatedContext.debugLogPath), /ENOENT/);
  } finally {
    await gatedContext.cleanup();
  }

  const cappedContext = await setupInitEnv();
  try {
    const env = {
      ...cappedContext.env,
      TOKENTRACKER_NOTIFY_DEBUG: "1",
      TOKENTRACKER_NOTIFY_DEBUG_MAX_BYTES: "64",
    };

    await runNotify(cappedContext.notifyPath, env);
    const first = await fs.readFile(cappedContext.debugLogPath, "utf8");
    assert.ok(first.length > 0);

    const limit = 64;
    const filler = "x".repeat(limit);
    await fs.writeFile(cappedContext.debugLogPath, filler, "utf8");
    await runNotify(cappedContext.notifyPath, env);
    const after = await fs.readFile(cappedContext.debugLogPath, "utf8");
    assert.equal(after, filler);
  } finally {
    await cappedContext.cleanup();
  }
});
