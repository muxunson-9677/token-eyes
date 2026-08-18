"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const initCommand = require("../src/commands/init");

test("init exposes its queue total reader for identity regression coverage", () => {
  assert.equal(typeof initCommand.readFirstSyncTotals, "function");
});

test("first-sync totals retain independent billing-mode rows in one bucket", async () => {
  const trackerDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-first-sync-attribution-"));
  try {
    const shared = {
      source: "codex",
      model: "gpt-5.4",
      hour_start: "2026-04-01T10:00:00.000Z",
    };
    await fs.writeFile(
      path.join(trackerDir, "queue.jsonl"),
      [
        { ...shared, billing_mode: "unknown", total_tokens: 10 },
        { ...shared, billing_mode: "api_key", total_tokens: 20 },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    );

    assert.deepEqual(initCommand.readFirstSyncTotals(trackerDir), {
      totalTokens: 30,
      sources: ["codex"],
    });
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});
