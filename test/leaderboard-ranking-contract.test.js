"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const REFRESH_PATH = path.join(
  ROOT,
  "dashboard/edge-patches/tokentracker-leaderboard-refresh.ts",
);
const LEGACY_READER_PATH = path.join(
  ROOT,
  "dashboard/edge-patches/tokentracker-leaderboard.ts",
);
const LEGACY_RPC_PATH = path.join(ROOT, "scripts/ops/leaderboard-ranking-rpc.sql");

test("legacy refresh edge no longer owns period aggregation", () => {
  const source = fs.readFileSync(REFRESH_PATH, "utf8");
  assert.doesNotMatch(source, /computeDateRange|tokentracker_hourly/);
  assert.match(source, /refresh_leaderboard_snapshot_dimensions/);
});

test("refresh edge delegates only claimed fixed dimensions", () => {
  const source = fs.readFileSync(REFRESH_PATH, "utf8");
  assert.match(source, /claim_leaderboard_dirty_dimensions/);
  assert.match(source, /period:\s*dimension\.period/);
  assert.match(source, /metric:\s*dimension\.metric/);
  assert.match(source, /source:\s*dimension\.source/);
  assert.doesNotMatch(source, /yesterday|"7d"|kiro-cli/);
});

test("legacy public reader and pageable ranking RPC are decommissioned", () => {
  assert.equal(fs.existsSync(LEGACY_READER_PATH), false);
  const sql = fs.readFileSync(LEGACY_RPC_PATH, "utf8");
  assert.match(sql, /drop function if exists public\.leaderboard_ranked/i);
  assert.doesNotMatch(sql, /create or replace function leaderboard_ranked/i);
});
