const assert = require("node:assert/strict");
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
    /trackerDataDir must be an absolute path under the OS temporary directory/u,
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
