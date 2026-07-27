"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert");

const ROOT = path.join(__dirname, "..");
const read = (name) =>
  fs.readFileSync(path.join(ROOT, "dashboard", "edge-patches", name), "utf8");

test("public leaderboard has a bounded, privacy-safe ranking RPC contract", () => {
  const source = read("tokentracker-leaderboard.ts");

  assert.match(source, /\.rpc\(\s*"leaderboard_ranked"/);
  assert.match(source, /today.*yesterday.*7d.*30d.*total/s);
  assert.match(source, /with_cache.*without_cache.*estimated_cost/s);
  assert.match(source, /LEADERBOARD_AGENT_SOURCES/);
  assert.match(source, /const limit = .*Math\.min\(.*100.*\)/);
  assert.match(source, /p_limit:\s*limit/);
  assert.match(source, /p_offset:\s*offset/);
  assert.match(source, /p_blocked_user_ids/);
  assert.doesNotMatch(source, /\.database\.from\(/);
  assert.match(source, /generated_at/);
  assert.match(source, /participant_count/);
  assert.match(source, /aggregate_total_tokens/);
  assert.match(source, /aggregate_total_cost_usd/);
});

test("authenticated self-rank endpoint derives identity only from a verified JWT", () => {
  const source = read("tokentracker-leaderboard-me.ts");

  assert.match(source, /\.from\("tokentracker_leaderboard_snapshots_v2"\)/);
  assert.match(source, /Authorization/);
  assert.match(source, /verifiedUserIdFromJwt|verifiedUserId/);
  assert.match(source, /auth\.getCurrentUser\(\)/);
  assert.match(source, /const PERIODS\s*=\s*new Set\(\["today", "week", "30d", "month", "total"\]\)/);
  assert.match(source, /\.eq\("user_id",\s*userId\)/);
  assert.doesNotMatch(source, /searchParams\.get\("user_id"\)/);
  assert.match(source, /Cache-Control":\s*"private, no-store"/);
});

test("direct leaderboard consumers read the v2 snapshot table", () => {
  for (const name of [
    "tokentracker-leaderboard-me.ts",
    "tokentracker-leaderboard-profile.ts",
    "tokentracker-badge-svg.ts",
    "tokentracker-embed-svg.ts",
  ]) {
    const source = read(name);
    assert.match(source, /tokentracker_leaderboard_snapshots_v2/, name);
    assert.doesNotMatch(
      source,
      /\.from\("tokentracker_leaderboard_snapshots"\)/,
      name,
    );
  }
});
