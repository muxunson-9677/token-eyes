"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const EDGE_PATH = path.resolve(
  "dashboard/edge-patches/tokentracker-leaderboard-refresh.ts",
);

test("leaderboard refresh is a scheduler-secret-only SQL wrapper", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.match(source, /LEADERBOARD_SCHEDULER_SECRET/);
  assert.match(source, /x-leaderboard-scheduler-secret/i);
  assert.match(source, /timingSafeEqual|constantTimeEqual/);
  assert.match(source, /refresh_leaderboard_snapshots/);
  assert.match(source, /p_refresh_month/);
  assert.match(source, /p_refresh_total/);
  assert.doesNotMatch(source, /tokentracker_hourly/);
  assert.doesNotMatch(source, /MODEL_PRICING|getModelPricing|computeRowCost/);
  assert.doesNotMatch(source, /Authorization:\s*`Bearer \$\{accessToken\}`/);
});

test("one 15-minute schedule gives hourly month and daily total refreshes", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.match(source, /Math\.floor\([^;]+\/\s*900\)/);
  assert.match(source, /slot\s*%\s*4\s*===\s*0/);
  assert.match(source, /slot\s*%\s*96\s*===\s*0/);
  assert.match(source, /today[^]*week[^]*30d/i);
});

test("response exposes operations metadata but never user rows", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.match(source, /row_counts/);
  assert.match(source, /duration_ms/);
  assert.match(source, /pricing_version/);
  assert.doesNotMatch(source, /display_name|avatar_url|github_url/);
});
