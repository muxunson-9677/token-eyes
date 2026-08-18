const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createLocalApiHandler } = require("./helpers/local-api.cjs");

test("local API test helper requires an explicit absolute temporary trackerDataDir", () => {
  assert.throws(
    () => createLocalApiHandler(),
    /test local API helper requires an explicit trackerDataDir/u,
  );
  assert.throws(
    () => createLocalApiHandler({ trackerDataDir: "relative-test-data" }),
    /trackerDataDir must be an absolute path under the OS temporary directory/u,
  );
  assert.throws(
    () => createLocalApiHandler({ trackerDataDir: path.resolve(__dirname, "fixtures") }),
    /trackerDataDir must resolve inside the OS temporary directory/u,
  );
});

test("local API test helper accepts an isolated temporary trackerDataDir", (t) => {
  const trackerDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-local-api-helper-"));
  t.after(() => fs.rmSync(trackerDataDir, { recursive: true, force: true }));

  const handler = createLocalApiHandler({
    queuePath: path.join(trackerDataDir, "queue.jsonl"),
    trackerDataDir,
  });
  assert.equal(typeof handler, "function");
});

test("local API skills suite removes its exact sandbox before exit", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tt-localapi-skills-contract-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const env = {
    ...process.env,
    TEMP: tempRoot,
    TMP: tempRoot,
  };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ["--test", path.resolve(__dirname, "local-api-skills.test.js")],
    { cwd: path.resolve(__dirname, ".."), env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /GET mode=skill_usage/u);
  assert.deepEqual(fs.readdirSync(tempRoot), []);
});
