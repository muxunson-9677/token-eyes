"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

test("local API exposes the injected Codex reset monitor lifecycle", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-reset-lifecycle-"));
  const calls = [];
  const service = {
    start: () => calls.push("start"),
    stop: () => calls.push("stop"),
  };
  const handler = createLocalApiHandler({
    queuePath: path.join(root, "missing-queue.jsonl"),
    trackerDataDir: root,
    codexResetMonitorService: service,
  });

  try {
    handler.startCodexResetMonitor();
    handler.stopCodexResetMonitor();
    assert.deepEqual(calls, ["start", "stop"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
