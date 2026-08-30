"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const EDGE_PATH = path.resolve(
  "dashboard/edge-patches/tokentracker-leaderboard-refresh.ts",
);
const VISIBILITY_EDGE_PATH = path.resolve(
  "dashboard/edge-patches/tokentracker-public-visibility.ts",
);

test("leaderboard refresh marks authenticated compact-state changes dirty", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.match(source, /LEADERBOARD_SCHEDULER_SECRET/);
  assert.match(source, /x-leaderboard-scheduler-secret/i);
  assert.match(source, /timingSafeEqual|constantTimeEqual/);
  assert.match(source, /auth\.getCurrentUser/);
  assert.match(source, /Authorization/i);
  assert.match(source, /mark_leaderboard_dimensions_dirty/);
  assert.match(source, /p_user_id/);
  assert.match(source, /compact-state-upload/);
  assert.match(source, /LEADERBOARD_DIRTY_TRIGGER_URL/);
  assert.match(source, /x-leaderboard-dirty-secret/i);
  assert.doesNotMatch(source, /refresh_leaderboard_snapshots/);
  assert.doesNotMatch(source, /tokentracker_hourly/);
  assert.doesNotMatch(source, /MODEL_PRICING|getModelPricing|computeRowCost/);
});

test("scheduler claims debounced dimensions and runs daily reconciliation", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.match(source, /claim_leaderboard_dirty_dimensions/);
  assert.match(source, /p_limit:\s*285/);
  assert.match(source, /refresh_leaderboard_snapshot_dimensions/);
  assert.match(source, /enqueue_leaderboard_daily_reconciliation/);
  assert.match(source, /daily-reconcile/);
});

test("response exposes operations metadata but never user rows", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.match(source, /row_counts/);
  assert.match(source, /duration_ms/);
  assert.match(source, /pricing_version/);
  assert.doesNotMatch(source, /display_name|avatar_url|github_url/);
});

test("scheduler publishes signed static dimensions before acknowledging dirty claims", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  assert.match(source, /LEADERBOARD_PUBLISH_URL/);
  assert.match(source, /x-leaderboard-publisher-secret/);
  assert.match(source, /static_dimensions/);
  const publishAt = source.indexOf("fetch(publishUrl");
  const ackAt = source.indexOf('"ack_leaderboard_dirty_dimensions"');
  assert.ok(publishAt >= 0 && ackAt > publishAt);
});

test("public profile mutations mark affected fixed leaderboard dimensions dirty", () => {
  const source = fs.readFileSync(VISIBILITY_EDGE_PATH, "utf8");
  const settingsWrite = source.indexOf("tokentracker_user_settings");
  const dirtyMark = source.lastIndexOf("mark_leaderboard_dimensions_dirty");
  assert.ok(settingsWrite >= 0 && dirtyMark > settingsWrite);
  assert.match(source, /p_user_id:\s*userId/);
  assert.match(source, /Leaderboard dirty mark failed/);
});
