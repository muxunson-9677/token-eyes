"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const EDGE_PATH = path.resolve(
  "dashboard/edge-patches/tokentracker-leaderboard-refresh.ts",
);

test("leaderboard refresh accepts the scheduler or a verified compact-state owner", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.match(source, /LEADERBOARD_SCHEDULER_SECRET/);
  assert.match(source, /x-leaderboard-scheduler-secret/i);
  assert.match(source, /timingSafeEqual|constantTimeEqual/);
  assert.match(source, /auth\.getCurrentUser/);
  assert.match(source, /Authorization/i);
  assert.match(source, /tokentracker_leaderboard_device_state/);
  assert.match(source, /captured_at/);
  assert.match(source, /generated_at/);
  assert.match(source, /refresh_leaderboard_snapshots/);
  assert.match(source, /p_refresh_month/);
  assert.match(source, /p_refresh_total/);
  assert.doesNotMatch(source, /tokentracker_hourly/);
  assert.doesNotMatch(source, /MODEL_PRICING|getModelPricing|computeRowCost/);
});

test("one 15-minute schedule keeps total current and refreshes month hourly", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.match(source, /Math\.floor\([^;]+\/\s*900\)/);
  assert.match(source, /slot\s*%\s*4\s*===\s*0/);
  assert.match(source, /const refreshTotal\s*=\s*true/);
  assert.match(source, /today[^]*week[^]*30d/i);
});

test("response exposes operations metadata but never user rows", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.match(source, /row_counts/);
  assert.match(source, /duration_ms/);
  assert.match(source, /pricing_version/);
  assert.doesNotMatch(source, /display_name|avatar_url|github_url/);
});
