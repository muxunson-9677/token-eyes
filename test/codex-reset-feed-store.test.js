"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Reset feed has no InsForge singleton store after static-feed migration", () => {
  assert.equal(fs.existsSync(
    path.resolve(__dirname, "../scripts/ops/codex-reset-feed-store.sql"),
  ), false);
  const edgeFiles = fs.readdirSync(path.resolve(__dirname, "../dashboard/edge-patches"));
  assert.equal(edgeFiles.includes("tokentracker-codex-reset-feed.ts"), false);
  assert.equal(edgeFiles.includes("tokentracker-codex-reset-collector.ts"), false);
});
