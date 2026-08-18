const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
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

test("NODE_ENV=test alone keeps ordinary CLI fallback inside its isolated home", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-node-env-test-"));
  const trackerDataDir = path.join(tmp, ".tokentracker", "tracker");
  await fs.promises.mkdir(trackerDataDir, { recursive: true });
  await fs.promises.writeFile(path.join(trackerDataDir, "relay-cookies.json"), "{}", "utf8");

  const env = {
    ...process.env,
    NODE_ENV: "test",
    HOME: tmp,
    USERPROFILE: tmp,
    LOCALAPPDATA: path.join(tmp, "AppData", "Local"),
    CODEX_HOME: path.join(tmp, ".codex"),
  };
  delete env.NODE_TEST_CONTEXT;

  try {
    const script = `
      const fs = require("node:fs");
      const os = require("node:os");
      const path = require("node:path");
      const localApi = require(process.argv[1]);
      const tempRoot = path.resolve(process.argv[2]);
      const accesses = [];
      for (const name of ["existsSync", "readFileSync", "mkdirSync"]) {
        const original = fs[name];
        fs[name] = function(filePath, ...args) {
          if (typeof filePath === "string" && /[\\\\\\/]\.(?:tokentracker|codex)(?:[\\\\\\/]|$)/u.test(filePath)) {
            accesses.push(path.resolve(filePath));
          }
          return original.call(this, filePath, ...args);
        };
      }
      const handler = localApi.createLocalApiHandler();
      if (typeof handler !== "function") throw new Error("handler was not created");
      if (path.resolve(os.homedir()) !== tempRoot) throw new Error("homedir escaped temp root");
      if (accesses.length === 0) throw new Error("isolated persistence path was not exercised");
      if (accesses.some((entry) => path.relative(tempRoot, entry).startsWith(".."))) {
        throw new Error("local API accessed a path outside the isolated home");
      }
    `;
    const result = spawnSync(process.execPath, ["-e", script, require.resolve("../src/lib/local-api.js"), tmp], {
      cwd: path.resolve(__dirname, ".."),
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
