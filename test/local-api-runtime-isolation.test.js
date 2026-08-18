const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const localApi = require("../src/lib/local-api.js");

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
    assert.throws(
      () => localApi.createLocalApiHandler({ queuePath: path.join(tmp, "queue.jsonl") }),
      /trackerDataDir/u,
    );
  } finally {
    os.homedir = originalHomedir;
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("test runner rejects an explicit queue path outside the OS temporary directory", async () => {
  const trackerDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-handler-path-scope-"));
  try {
    assert.throws(
      () => localApi.createLocalApiHandler({
        queuePath: path.resolve(__dirname, "fixtures", "queue.jsonl"),
        trackerDataDir,
      }),
      /queuePath must resolve inside the OS temporary directory/u,
    );
  } finally {
    await fs.promises.rm(trackerDataDir, { recursive: true, force: true });
  }
});

test("canonical test path validation rejects a temporary junction into the repository", async (t) => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-handler-junction-"));
  t.after(() => fs.promises.rm(tmp, { recursive: true, force: true }));
  const linkedTrackerDir = path.join(tmp, "linked-tracker");
  try {
    await fs.promises.symlink(path.resolve(__dirname, ".."), linkedTrackerDir, "junction");
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
    t.skip(`junction unavailable: ${error.code}`);
    return;
  }

  assert.throws(
    () => localApi.validateLocalApiTestPaths({
      queuePath: path.join(tmp, "queue.jsonl"),
      trackerDataDir: path.join(linkedTrackerDir, "nonexistent-child"),
    }),
    /trackerDataDir must resolve inside the OS temporary directory/u,
  );

  const trackerDataDir = path.join(tmp, "tracker");
  await fs.promises.mkdir(trackerDataDir);
  assert.throws(
    () => localApi.validateLocalApiTestPaths({
      queuePath: path.join(trackerDataDir, "queue.jsonl"),
      trackerDataDir,
      machineIdSeedPath: path.join(linkedTrackerDir, "machine-id"),
    }),
    /machineIdSeedPath must resolve inside trackerDataDir/u,
  );
});

test("machine-id route confines every persistence access to trackerDataDir in test runners", async (t) => {
  const trackerDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-machine-route-scope-"));
  t.after(() => fs.promises.rm(trackerDataDir, { recursive: true, force: true }));
  const queuePath = path.join(trackerDataDir, "queue.jsonl");
  await fs.promises.writeFile(
    path.join(trackerDataDir, "config.json"),
    JSON.stringify({ machineId: "stable-machine-id" }),
    "utf8",
  );
  const handler = localApi.createLocalApiHandler({ queuePath, trackerDataDir });
  const accesses = [];
  const originals = new Map();
  for (const name of ["readFileSync", "writeFileSync", "mkdirSync", "renameSync"]) {
    const original = fs[name];
    originals.set(name, original);
    fs[name] = function scopedFsProbe(filePath, ...args) {
      if (typeof filePath === "string") accesses.push(path.resolve(filePath));
      return original.call(this, filePath, ...args);
    };
  }
  t.after(() => {
    for (const [name, original] of originals) fs[name] = original;
  });

  const url = new URL("/functions/tokentracker-machine-id", "http://localhost:7680");
  const body = await new Promise((resolve, reject) => {
    const req = { method: "GET", headers: {}, url };
    req[Symbol.for("tokentracker.test.localApiSecurityBypass")] = true;
    const res = {
      writeHead() {},
      end(payload) {
        try {
          resolve(JSON.parse(payload));
        } catch (error) {
          reject(error);
        }
      },
    };
    Promise.resolve(handler(req, res, url)).catch(reject);
  });

  assert.equal(body.machineId, "stable-machine-id");
  assert.ok(accesses.length > 0);
  assert.ok(
    accesses.every((entry) => {
      const relative = path.relative(trackerDataDir, entry);
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    }),
    `machine-id route escaped trackerDataDir: ${accesses.join(", ")}`,
  );
});

test("test-runner routes inject trackerDataDir as their isolated home", async (t) => {
  const trackerDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-route-home-scope-"));
  t.after(() => fs.promises.rm(trackerDataDir, { recursive: true, force: true }));
  let receivedHome = null;
  let receivedDirectoryHome = null;
  const handler = localApi.createLocalApiHandler({
    trackerDataDir,
    usageLimitsProvider: async ({ home }) => {
      receivedHome = home;
      return {};
    },
    tokenOnlyDirectoryStatesProvider: (_settings, { home }) => {
      receivedDirectoryHome = home;
      return {};
    },
  });
  const url = new URL("/functions/tokentracker-usage-limits", "http://localhost:7680");
  await new Promise((resolve, reject) => {
    const req = { method: "GET", headers: {}, url };
    req[Symbol.for("tokentracker.test.localApiSecurityBypass")] = true;
    const res = { writeHead() {}, end: resolve };
    Promise.resolve(handler(req, res, url)).catch(reject);
  });
  assert.equal(receivedHome, trackerDataDir);
  assert.equal(receivedDirectoryHome, trackerDataDir);
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
