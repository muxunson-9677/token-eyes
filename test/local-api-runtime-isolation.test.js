const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

test("production Vite config does not instantiate the local API handler", async () => {
  const localApiPath = require.resolve("../src/lib/local-api.js");
  const localApi = require(localApiPath);
  const originalFactory = localApi.createLocalApiHandler;
  localApi.createLocalApiHandler = () => {
    throw new Error("local API handler instantiated during config load");
  };

  try {
    const configUrl = `${pathToFileURL(path.resolve(__dirname, "../dashboard/vite.config.js")).href}?test=${Date.now()}`;
    const configModule = await import(configUrl);
    assert.doesNotThrow(() => configModule.default({ command: "build", mode: "production" }));
  } finally {
    localApi.createLocalApiHandler = originalFactory;
  }
});

test("node tests reject a local API handler without an explicit trackerDataDir", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-handler-guard-"));
  const originalHomedir = os.homedir;
  os.homedir = () => tmp;

  try {
    const { createLocalApiHandler } = require("../src/lib/local-api.js");
    assert.throws(
      () => createLocalApiHandler({ queuePath: path.join(tmp, "queue.jsonl") }),
      /trackerDataDir/u,
    );
  } finally {
    os.homedir = originalHomedir;
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
