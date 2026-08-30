"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const SCRIPT_PATH = path.resolve(__dirname, "../scripts/leaderboard-capacity-model.cjs");

test("capacity model covers 10k, 50k, and 100k installs with fixed 285 Durable Object objects", () => {
  const model = require(SCRIPT_PATH).buildCapacityModel();
  assert.deepEqual(model.scenarios.map((item) => item.install_users), [10_000, 50_000, 100_000]);
  assert.equal(model.cloudflare_account_verified_free, true);
  for (const scenario of model.scenarios) {
    assert.equal(scenario.static_object_count, 285);
    assert.equal(scenario.public_reads_use_insforge, false);
    assert.equal(scenario.public_reads_require_auth, false);
    assert.ok(scenario.public_static_reads_per_month > 0);
    assert.ok(scenario.raw_public_object_writes_per_day > 0);
    assert.ok(scenario.durable_object_public_storage_gib < model.cloudflare_free_limits.durable_object_storage_gib);
    assert.ok(scenario.raw_durable_object_requests_per_day > scenario.worker_dirty_trigger_requests_per_day);
  }
});

test("raw 60-second load exposes the hard-stop boundary instead of promising unlimited free service", () => {
  const model = require(SCRIPT_PATH).buildCapacityModel();
  const [small, medium, large] = model.scenarios;
  assert.equal(small.requires_zero_dollar_degradation, false);
  assert.equal(medium.requires_zero_dollar_degradation, true);
  assert.equal(large.requires_zero_dollar_degradation, true);
  assert.ok(medium.raw_durable_object_requests_per_day > small.raw_durable_object_requests_per_day);
  assert.ok(large.raw_durable_object_requests_per_day > medium.raw_durable_object_requests_per_day);
  assert.equal(model.cloudflare_free_limits.excess_behavior, "operations fail; no usage billing on Workers Free");
});

test("zero-dollar hard gate remains below platform limits and never disables local features", () => {
  const model = require(SCRIPT_PATH).buildCapacityModel();
  assert.ok(model.hard_gate.durable_daily_request_stop_at < model.cloudflare_free_limits.durable_object_requests_per_day);
  assert.ok(model.hard_gate.durable_daily_write_stop_at < model.cloudflare_free_limits.durable_object_rows_written_per_day);
  for (const scenario of model.scenarios) {
    assert.ok(scenario.gated_durable_object_requests_per_day <= model.hard_gate.durable_daily_request_stop_at);
    assert.ok(scenario.gated_durable_object_rows_written_per_day <= model.hard_gate.durable_daily_write_stop_at);
    assert.equal(scenario.auto_enable_billing, false);
    assert.equal(scenario.unbounded_usage_billing, false);
    assert.equal(scenario.local_core_available, true);
    assert.equal(scenario.degradation_order.at(-1), "serve-edge-cache-or-client-lkg");
  }
});

test("CLI prints machine-readable scenarios and official-limit provenance", () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Leaderboard zero-dollar capacity/);
  assert.match(result.stdout, /"install_users": 100000/);
  assert.match(result.stdout, /developers\.cloudflare\.com\/workers\/platform\/pricing/);
  assert.match(result.stdout, /developers\.cloudflare\.com\/durable-objects\/platform\/pricing/);
  assert.match(result.stdout, /"auto_enable_billing": false/);
  assert.doesNotMatch(result.stdout, /r2_/i);
});
