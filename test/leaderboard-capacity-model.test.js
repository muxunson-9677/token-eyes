"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const SCRIPT_PATH = path.resolve(__dirname, "../scripts/leaderboard-capacity-model.cjs");

test("6,000-participant model stays inside the zero-cost operating envelope", () => {
  const { buildCapacityModel } = require(SCRIPT_PATH);
  const model = buildCapacityModel();

  assert.equal(model.assumptions.participants, 6_000);
  assert.ok(
    model.capacity.uploads_per_month
      <= 180_000 + model.capacity.first_login_allowance,
  );
  assert.ok(model.capacity.upload_payload_bytes <= 8_192);
  assert.ok(model.capacity.upload_bandwidth_gib <= 1.5);
  assert.ok(model.capacity.global_refresh_calls_per_month <= 2_880);
  assert.ok(model.capacity.worker_requests_per_day <= 30_000);
  assert.ok(model.capacity.estimated_database_megabytes <= 300);
  assert.ok(model.capacity.avatar_megabytes <= 100);
  assert.equal(model.within_envelope, true);
});

test("70% warning actions reduce cache and refresh frequency without enabling billing", () => {
  const { buildCapacityModel } = require(SCRIPT_PATH);
  const model = buildCapacityModel();

  assert.deepEqual(model.actions.public_ttl_minutes, [15, 30, 60]);
  assert.deepEqual(model.actions.month_refresh_hours, [1, 4]);
  assert.deepEqual(model.actions.total_refresh_days, [1, 2]);
  assert.equal(model.actions.keep_today_week_at_15_minutes, true);
  assert.equal(model.actions.auto_enable_billing, false);
  assert.equal(model.actions.disable_local_features, false);
});

test("CLI prints both machine-readable JSON and a readable capacity table", () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Leaderboard free-tier capacity/);
  assert.match(result.stdout, /uploads_per_month/);
  assert.match(result.stdout, /"within_envelope": true/);
});
