"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert");

const ROOT = path.join(__dirname, "..");
const read = (name) =>
  fs.readFileSync(path.join(ROOT, "dashboard", "edge-patches", name), "utf8");

test("public leaderboard has a bounded, privacy-safe read contract", () => {
  const source = read("tokentracker-leaderboard.ts");

  assert.match(source, /\.from\("tokentracker_leaderboard_snapshots_v2"\)/);
  assert.match(source, /today.*week.*month.*total/s);
  assert.match(source, /tokens.*estimated_spend.*actual_cost/s);
  assert.match(source, /KNOWN_SOURCES/);
  assert.match(source, /const limit = .*Math\.min\(.*100.*\)/);
  assert.match(source, /\.range\(offset,\s*offset \+ limit - 1\)/);
  assert.match(source, /\.eq\("is_public",\s*true\)/);
  assert.doesNotMatch(source, /searchParams\.get\("user_id"\)/);
  assert.doesNotMatch(source, /unsafeDecodeJwtSub/);
  assert.match(source, /generated_at/);
  assert.match(source, /pricing_version/);
  assert.match(source, /stale/);
});

test("authenticated self-rank endpoint derives identity only from a verified JWT", () => {
  const source = read("tokentracker-leaderboard-me.ts");

  assert.match(source, /\.from\("tokentracker_leaderboard_snapshots_v2"\)/);
  assert.match(source, /Authorization/);
  assert.match(source, /verifiedUserIdFromJwt|verifiedUserId/);
  assert.match(source, /JWT_SECRET/);
  assert.match(source, /\.eq\("user_id",\s*userId\)/);
  assert.doesNotMatch(source, /searchParams\.get\("user_id"\)/);
  assert.match(source, /Cache-Control":\s*"private, no-store"/);
});

test("all current leaderboard consumers read the v2 snapshot table", () => {
  for (const name of [
    "tokentracker-leaderboard.ts",
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
