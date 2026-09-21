"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const { buildNotifyHandler, refreshInstalledNotifyHandler } = require("../src/commands/init");

const legacyGate = `    let deviceToken = process.env.TOKENTRACKER_DEVICE_TOKEN || null;
    if (!deviceToken) {
      try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (cfg && typeof cfg.deviceToken === 'string') deviceToken = cfg.deviceToken;
      } catch (_) {}
    }
    const canSync = Boolean(deviceToken && deviceToken.length > 0);
`;

function oldHandler(trackerDir) {
  return buildNotifyHandler({ trackerDir })
    .replace("const fallbackPkg =", "  const configPath = path.join(trackerDir, 'config.json');\nconst fallbackPkg =")
    .replace("    const now = Date.now();", `${legacyGate}    const now = Date.now();`)
    .replace("if (now - last > 20_000)", "if (canSync && now - last > 20_000)");
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-eyes-notify-upgrade-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const trackerDir = path.join(root, "tracker");
  const notifyPath = path.join(root, "bin", "notify.cjs");
  await fs.mkdir(trackerDir);
  await fs.mkdir(path.dirname(notifyPath));
  return { root, trackerDir, notifyPath };
}

test("refreshes only the exact old owned handler and preserves original chains and config", async (t) => {
  const { trackerDir, notifyPath } = await fixture(t);
  const originals = ["codex_notify_original.json", "code_notify_original.json", "config.json"];
  for (const file of originals) await fs.writeFile(path.join(trackerDir, file), "preserve exactly");
  await fs.writeFile(notifyPath, oldHandler(trackerDir).replace(/\n/g, "\r\n"));
  assert.equal(await refreshInstalledNotifyHandler({ trackerDir }), "updated");
  assert.equal(await fs.readFile(notifyPath, "utf8"), buildNotifyHandler({ trackerDir }));
  for (const file of originals) assert.equal(await fs.readFile(path.join(trackerDir, file), "utf8"), "preserve exactly");
  const before = (await fs.stat(notifyPath)).mtimeMs;
  assert.equal(await refreshInstalledNotifyHandler({ trackerDir }), "current");
  assert.equal((await fs.stat(notifyPath)).mtimeMs, before);
});

test("does not create a hook or replace custom and wrong-directory handlers", async (t) => {
  const { trackerDir, notifyPath } = await fixture(t);
  assert.equal(await refreshInstalledNotifyHandler({ trackerDir }), "missing");
  await assert.rejects(fs.stat(notifyPath), { code: "ENOENT" });
  for (const text of ["// user script\n", oldHandler(trackerDir) + "// customization\n", oldHandler(path.join(trackerDir, "another"))]) {
    await fs.writeFile(notifyPath, text);
    assert.equal(await refreshInstalledNotifyHandler({ trackerDir }), "unrecognized");
    assert.equal(await fs.readFile(notifyPath, "utf8"), text);
  }
});

test("normal serve startup refreshes the existing handler after the runtime without running init", async (t) => {
  const { trackerDir, notifyPath } = await fixture(t);
  await fs.writeFile(notifyPath, oldHandler(trackerDir));
  const servePath = path.resolve(__dirname, "../src/commands/serve.js");
  const load = createRequire(servePath);
  const stages = [];
  const sentinel = new Error("stop before starting the server");
  const context = { module: { exports: {} }, __dirname: path.dirname(servePath), process: { env: {}, stdout: { write() {} } }, require(name) {
    if (name === "../lib/tracker-paths") return { resolveTrackerPaths: async () => ({ trackerDir }) };
    if (name === "node:fs") return { existsSync: () => true };
    if (name === "../lib/local-api") return { resolveQueuePath() { throw sentinel; } };
    if (name === "./init") return {
      cmdInit() { assert.fail("must not reinstall integrations"); },
      async installLocalTrackerApp() { stages.push("runtime"); },
      async refreshInstalledNotifyHandler(options) { stages.push("notify"); return refreshInstalledNotifyHandler(options); },
    };
    return load(name);
  } };
  vm.runInNewContext(await fs.readFile(servePath, "utf8"), context);
  await assert.rejects(context.module.exports.cmdServe(["--no-sync", "--no-open"]), (error) => error === sentinel);
  assert.deepEqual(stages, ["runtime", "notify"]);
  assert.equal(await fs.readFile(notifyPath, "utf8"), buildNotifyHandler({ trackerDir }));
});
